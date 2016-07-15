// https://github.com/Matt-Esch/virtual-dom/pull/271

import * as d3 from 'd3';
import { range, inRange, identity } from 'lodash';
import { Subject, Observable } from 'rx-lite';
import { Option, None } from './option';
import { h, diff, patch, create, VNode } from 'virtual-dom';
import svg = require('virtual-dom/virtual-hyperscript/svg');
import virtualize = require('vdom-virtualize');

interface Revision {
    id: number
    datasetSlug: string
    createdAt: Date
    authorName: string
}

type Focus = { offsetY: number, offsetX: number };

interface State {
    revisions: Revision[]
    baseMode: boolean
    maybeHead: Option<Date>
    maybeBase: Option<Date>
    maybeFocus: Option<Focus>
    maybeDebouncedFocus: Option<Focus>
    xScale: d3.time.Scale<number, number>
    maybeFocusedRevisions: Option<Revision[]>
}

const rint = (n: number) => (Math.random() * (n + 1)) | 0;
const rdate = (): Date => new Date(2016, rint(11), rint(28), rint(23));
const revisions$: Observable<Revision[]> = Observable.timer(2000).map(x => (
    range(0, 30).map((x, id) => ({
        id,
        datasetSlug: 'fraud',
        createdAt: rdate(),
        authorName: 'Bob'
    }))
))
    .startWith([])

const radius = 15;
const margin = {top: 0, right: radius, bottom: 30, left: radius};
const outerWidth = 700;
const outerHeight = 100;
const width = outerWidth - margin.left - margin.right;
const height = outerHeight - margin.top - margin.bottom;
const lineWidth = 3;

//
// Observables and subjects
//

const resetSubject = new Subject<boolean>()
const baseModeSubject = new Subject<boolean>()
const baseSubject = new Subject<Option<Date>>()
const headSubject = new Subject<Option<Date>>()
const focusSubject = new Subject<Option<Focus>>()
const focusedRevisionsHoverSubject = new Subject<boolean>()

const inputHead$: Observable<Option<Date>> = Observable.merge(headSubject, resetSubject.map(x => None))
    .startWith(None)
const inputBase$: Observable<Option<Date>> = Observable.merge(
    baseSubject,
    resetSubject.map(x => None)
)
    .startWith(None);
const baseMode$: Observable<boolean> = Observable.merge(
    baseModeSubject,
    resetSubject.map(x => false),
    inputBase$.map(x => false)
)
    .startWith(false);

const base$: Observable<Option<Date>> = Observable.combineLatest(inputBase$, inputHead$)
    .withLatestFrom(baseMode$)
    .scan((maybeCurrentBase, [ [ maybeInputBase, maybeInputHead ], baseMode ]) => (
        baseMode
            ? maybeInputBase
            : maybeCurrentBase.flatMap(currentBase => (
                maybeInputHead.map(inputHead => inputHead < currentBase ? inputHead : currentBase)
            ))
    ), None as Option<Date>)
const head$: Observable<Option<Date>> = Observable.combineLatest(inputHead$, inputBase$)
    .withLatestFrom(baseMode$)
    .scan((maybeCurrentHead, [ [ maybeInputHead, maybeInputBase ], baseMode ]) => (
        baseMode
            ? maybeCurrentHead.flatMap(currentHead => (
                maybeInputBase.map(inputBase => inputBase > currentHead ? inputBase : currentHead)
            ))
            : maybeInputHead
    ), None as Option<Date>)
const focus$: Observable<Option<Focus>> = focusSubject.startWith(None);
const focusedRevisionsHover$: Observable<boolean> = focusedRevisionsHoverSubject.startWith(false);

const createXScale = (revisions: Revision[]): d3.time.Scale<number, number> => (
    d3.time.scale()
        .domain(d3.extent(revisions.map(d => d.createdAt.getTime())))
        .range([0, width])
)
const initialState = {
    revisions: [] as Revision[],
    baseMode: false,
    maybeHead: None,
    maybeBase: None,
    maybeFocus: None,
    maybeDebouncedFocus: None,
    xScale: createXScale([]),
    maybeFocusedRevisions: None,
};
const state$: Observable<State> = Observable.combineLatest(
    revisions$, baseMode$, head$, base$, focus$, focus$.debounce(300), focusedRevisionsHover$
).scan((previousState, [ revisions, baseMode, maybeHead, maybeBase, maybeFocus, maybeDebouncedFocus, focusedRevisionsHover ]) => {
    const xScale = createXScale(revisions);
    const getRevisionsFor = (x: number): Revision[] => (
        revisions.filter(revision => {
            const x2 = xScale(revision.createdAt);
            const xLowerBound = x2 - radius;
            const xUpperBound = x2 + radius;
            const isRevisionInBounds = inRange(x - (lineWidth / 2), xLowerBound, xUpperBound)
                || inRange(x + (lineWidth / 2), xLowerBound, xUpperBound);
            return isRevisionInBounds;
        })
    );
    const maybeFocusedRevisions = focusedRevisionsHover
        ? previousState.maybeFocusedRevisions
        : maybeDebouncedFocus
            .map(focus => getRevisionsFor(focus.offsetX))
            .filter(revisions => revisions.length > 0);
    return {
        revisions, baseMode, maybeHead, maybeBase, maybeFocus,
        maybeDebouncedFocus: focusedRevisionsHover ? previousState.maybeDebouncedFocus : maybeDebouncedFocus,
        xScale, maybeFocusedRevisions
    };
}, initialState)

//
// Rendering
//

const createLine = (className: string, translateX: number, shouldHide: boolean, label: string, invertMarker: boolean): VNode => (
    svg('g', {
        transform: `translate(${translateX})`,
        style: { display: shouldHide ? 'none' : '' }
    }, [
        svg('text', {
            attributes: {
                'text-anchor': invertMarker ? 'end' : ''
            },
            x: ((lineWidth / 2) + 3) * (invertMarker ? -1 : 1),
            y: 9,
            style: {
                textTransform: 'uppercase',
                fontFamily: 'sans-serif',
                fontSize: '11px'
            }
        }, label),
        svg('line', {
            y1: 0,
            y2: outerHeight - margin.bottom,
            class: className,
            attributes: { 'stroke-width': String(lineWidth) }
        }, [])
    ])
);

const svgns = "http://www.w3.org/2000/svg";
const d3AxisToElement = (d3Axis: d3.svg.Axis): Element => (
    <Element>d3.select(document.createElementNS(svgns, 'svg'))
        .call(d3Axis)
        .node()
);

const render = ({ revisions, baseMode, maybeHead, maybeBase, maybeFocus, maybeDebouncedFocus, xScale, maybeFocusedRevisions }: State) => {
    console.log('render');

    const xAxis = d3.svg.axis().scale(xScale)
    const xAxisVNode = virtualize(d3AxisToElement(xAxis));

    const maybeOffsetX = maybeFocus.map(x => x.offsetX);
    const createHeadLine = (isFocusLine: boolean = false) => (
        createLine(
            ['head-line', isFocusLine ? 'focus-line' : ''].filter(identity).join(' '),
            isFocusLine ? maybeOffsetX.getOrElse(0) : maybeHead.map(d => xScale(d)).getOrElse(0),
            isFocusLine ? maybeOffsetX.isEmpty : maybeHead.isEmpty,
            'Head',
            false
        )
    );
    const createBaseLine = (isFocusLine: boolean = false) => (
        createLine(
            ['base-line', isFocusLine ? 'focus-line' : ''].filter(identity).join(' '),
            isFocusLine ? maybeOffsetX.getOrElse(0) : maybeBase.map(d => xScale(d)).getOrElse(0),
            isFocusLine ? maybeOffsetX.isEmpty : maybeBase.isEmpty,
            'Base',
            true
        )
    );

    const createRevision = (revision: Revision): VNode => (
        svg('circle', {
            class: 'dot',
            r: String(radius),
            cx: String(xScale(revision.createdAt)),
            cy: String(height / 2)
        }, [ svg('title', [ String(revision.id) ]) ])
    );

    const createMasks = (): VNode => (
        svg('g', maybeBase.flatMap(base => (
            maybeHead.map(head => (
                [
                    svg('rect', {
                        class: 'mask',
                        x: margin.left * -1,
                        width: xScale(base) + margin.left,
                        height: outerHeight - margin.bottom
                    }, []),
                    svg('rect', {
                        class: 'mask',
                        x: xScale(head),
                        width: width - xScale(head) + margin.right,
                        height: outerHeight - margin.bottom
                    }, [])
                ]
            ))
        )).getOrElse([]))
    );

    class FocusedRevisionsListTransformHook {
        constructor() {}

        hook(node: HTMLElement) {
            setTimeout(() => {
                const offsetX = maybeDebouncedFocus.map(focus => focus.offsetX).getOrElse(0);
                const offsetY = maybeDebouncedFocus.map(focus => focus.offsetY).getOrElse(0);
                node.style.transform = `translate(
                    ${offsetX + margin.left + Math.floor(lineWidth / 2)}px,
                    ${node.offsetHeight * -1}px
                )`;
            });
        }
    }

    return h('div', [
        h('h1', 'Tardis'),
        h('div', { style: { position: 'relative', marginTop: '150px' } }, [
            svg('svg', { width: outerWidth, height: outerHeight, style: { display: 'block' } }, [
                svg('g', { transform: `translate(${margin.left},${margin.top})` }, [
                    svg('g', { class: 'x axis', transform: `translate(0,${height})` }, [ xAxisVNode ]),
                    svg('g', revisions.map(createRevision)),
                    createMasks(),
                    createHeadLine(),
                    createBaseLine(),
                    baseMode ? createBaseLine(true) : createHeadLine(true),
                    svg('rect', {
                        class: 'overlay',
                        width: String(width),
                        height: String(outerHeight),
                        onmousemove: (event: MouseEvent) => {
                            const { offsetY, offsetX } = event;
                            focusSubject.onNext(Option({ offsetY, offsetX }))
                        },
                        onclick: (event: MouseEvent) => {
                            if (baseMode) {
                                const x = event.offsetX;
                                const date = xScale.invert(x);
                                baseSubject.onNext(Option(date));
                            } else {
                                const x = event.offsetX;
                                const date = xScale.invert(x);
                                headSubject.onNext(Option(date));
                            }
                        },
                        onmouseleave: () => focusSubject.onNext(None)
                    }, [])
                ])
            ]),
            maybeFocusedRevisions
                .map((focusedRevisions): VNode | undefined => (
                    h('ul', {
                        style: {
                            border: '1px solid',
                            position: 'absolute',
                            top: 0,
                            willChange: 'transform',
                            margin: 0,
                            background: 'white',
                        },
                        "transform-hook": new FocusedRevisionsListTransformHook(),
                        onmouseenter: () => focusedRevisionsHoverSubject.onNext(true),
                        onmouseleave: () => focusedRevisionsHoverSubject.onNext(false)
                    }, focusedRevisions.map(revision => h('li', JSON.stringify(revision))))
                ))
                .getOrElse(undefined),
        ]),
        h('div', [
            h('button', { onclick: (event: MouseEvent) => resetSubject.onNext(true) }, [ 'Reset' ]),
            h('label', [
                h('input', {
                    onchange: (event: Event) => baseModeSubject.onNext((event.target as HTMLInputElement).checked),
                    type: 'checkbox',
                    checked: baseMode
                }, []),
                'Select base'
            ])
        ]),
        h('div', [
            h('p', `Version of dataset (head): ${maybeHead.map(head => String(head.getTime())).getOrElse('')}`),
            h('p', `Show changes since (base): ${maybeBase.map(base => String(base.getTime())).getOrElse('')}`),
        ])
    ]);
};

const renderVNodeToDom = (containerNode: Element) => {
    let currentVNode: VNode, rootNode: Element;
    return (newVNode: VNode) => {
        if (!rootNode) {
            rootNode = create(newVNode);
            containerNode.appendChild(rootNode);
        }
        const patches = diff(currentVNode || newVNode, newVNode);
        rootNode = patch(rootNode, patches);
        currentVNode = newVNode;
    };
};

state$
    .map(render)
    .subscribe(renderVNodeToDom(document.body));
