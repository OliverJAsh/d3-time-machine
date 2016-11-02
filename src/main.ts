// https://github.com/Matt-Esch/virtual-dom/pull/271

import * as d3 from 'd3';
import { range, inRange, identity, min, max } from 'lodash';
import { Subject, Observable, DOM } from 'rx-lite-dom';
import { Option, None, flatten } from './option';
import { h, diff, patch, create, VNode } from 'virtual-dom';
import svg = require('virtual-dom/virtual-hyperscript/svg');
import virtualize = require('vdom-virtualize');

interface Revision {
    id: number
    datasetSlug: string
    createdAt: Date
    authorName: string
}

interface State {
    revisions: Revision[]
    baseMode: boolean
    maybeHead: Option<Date>
    maybeBase: Option<Date>
    maybeFocusOffsetX: Option<number>
    maybeTooltipOffsetX: Option<number>
    xScale: d3.time.Scale<number, number>
    maybeTooltipRevisions: Option<Revision[]>
    outerWidth: number
}

const radius = 15;
const margin = {top: 0, right: radius, bottom: 30, left: radius};
const outerHeight = 100;
const height = outerHeight - margin.top - margin.bottom;
const lineWidth = 3;

//
// Observables and subjects
//

const resetSubject = new Subject<boolean>()
const baseModeSubject = new Subject<boolean>()
const baseSubject = new Subject<Option<Date>>()
const headSubject = new Subject<Option<Date>>()
const focusOffsetXSubject = new Subject<Option<number>>()
const tooltipHoverSubject = new Subject<boolean>()

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

const inputHead$: Observable<Option<Date>> = Observable.merge(
    headSubject,
    resetSubject.map(x => None)
)
    .startWith(None);
const inputBase$: Observable<Option<Date>> = Observable.merge(
    baseSubject,
    resetSubject.map(x => None)
)
    .startWith(None);
const baseMode$: Observable<boolean> = Observable.merge(
    baseModeSubject,
    resetSubject.map(x => false),
)
    .startWith(false);

const maxOptions = <A>(options: Option<A>[]): Option<A> => Option(max(flatten(options)));
const minOptions = <A>(options: Option<A>[]): Option<A> => Option(min(flatten(options)));

// Head is the largest of input base and current head
const base$: Observable<Option<Date>> = Observable.combineLatest(inputBase$, inputHead$)
    .withLatestFrom(baseMode$)
    .scan((maybeCurrentBase, [ [ maybeInputBase, maybeInputHead ], baseMode ]) => (
		baseMode ? maybeInputBase : minOptions([ maybeCurrentBase.orElse(maybeInputBase), maybeInputHead ])
    ), None as Option<Date>)
const head$: Observable<Option<Date>> = Observable.combineLatest(inputHead$, inputBase$)
    .withLatestFrom(baseMode$)
    .scan((maybeCurrentHead, [ [ maybeInputHead, maybeInputBase ], baseMode ]) => (
		baseMode ? maxOptions([ maybeCurrentHead.orElse(maybeInputHead), maybeInputBase ]) : maybeInputHead
    ), None as Option<Date>)
const focusOffsetX$: Observable<Option<number>> = focusOffsetXSubject.startWith(None);
const tooltipHover$: Observable<boolean> = tooltipHoverSubject.startWith(false);
const tooltipFocusOffsetX$: Observable<Option<number>> = (
    Observable.combineLatest(focusOffsetX$.debounce(300), tooltipHover$)
        .scan((previousMaybeTooltipOffsetX, [ maybeTooltipOffsetX, tooltipHover ]) => (
            tooltipHover ? previousMaybeTooltipOffsetX : maybeTooltipOffsetX
        ), None as Option<number>)
        .startWith(None)
);
const outerWidth$ = DOM.fromEvent(window, 'resize').map(x => document.body.offsetWidth).startWith(document.body.offsetWidth);

const createXScale = (width: number, revisions: Revision[]): d3.time.Scale<number, number> => (
    d3.time.scale()
        .domain(d3.extent(revisions.map(d => d.createdAt.getTime())))
        .range([0, width])
)

const state$: Observable<State> = Observable.combineLatest(
    revisions$, baseMode$, head$, base$, focusOffsetX$, tooltipFocusOffsetX$, tooltipHover$, outerWidth$
).map(([ revisions, baseMode, maybeHead, maybeBase, maybeFocusOffsetX, maybeTooltipOffsetX, tooltipHover, outerWidth ]) => {
    const xScale = createXScale(outerWidth - margin.left - margin.right, revisions);
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
    const maybeTooltipRevisions = maybeTooltipOffsetX
        .map(getRevisionsFor)
        .filter(revisions => revisions.length > 0);
    return {
        revisions,
        baseMode,
        maybeHead,
        maybeBase,
        maybeFocusOffsetX,
        maybeTooltipOffsetX,
        xScale,
        maybeTooltipRevisions,
        outerWidth
    };
})

//
// Rendering
//

const createLine = (className: string, translateX: number, shouldHide: boolean, label: string, invertMarker: boolean): VNode | undefined => (
    shouldHide ? undefined : svg('g', { transform: `translate(${translateX})` }, [
        svg('text', {
            class: 'line-label',
            attributes: { 'text-anchor': invertMarker ? 'end' : '' },
            x: ((lineWidth / 2) + 3) * (invertMarker ? -1 : 1),
            y: 9,
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
    <Element>d3.select(create(svg('svg', [])))
        .call(d3Axis)
        .node()
);

const render = ({ revisions, baseMode, maybeHead, maybeBase, maybeFocusOffsetX, maybeTooltipOffsetX, xScale, maybeTooltipRevisions, outerWidth }: State) => {
    console.log('render');

    const xAxis = d3.svg.axis().scale(xScale)
    const xAxisVNode = virtualize(d3AxisToElement(xAxis));

    const createHeadLine = (isFocusLine: boolean = false) => (
        createLine(
            ['head-line', isFocusLine ? 'focus-line' : ''].filter(identity).join(' '),
            isFocusLine ? maybeFocusOffsetX.getOrElse(0) : maybeHead.map(d => xScale(d)).getOrElse(0),
            isFocusLine ? maybeFocusOffsetX.isEmpty : maybeHead.isEmpty,
            'Head',
            false
        )
    );
    const createBaseLine = (isFocusLine: boolean = false) => (
        createLine(
            ['base-line', isFocusLine ? 'focus-line' : ''].filter(identity).join(' '),
            isFocusLine ? maybeFocusOffsetX.getOrElse(0) : maybeBase.map(d => xScale(d)).getOrElse(0),
            isFocusLine ? maybeFocusOffsetX.isEmpty : maybeBase.isEmpty,
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
                        width: outerWidth - margin.left - margin.right - xScale(head) + margin.right,
                        height: outerHeight - margin.bottom
                    }, [])
                ]
            ))
        )).getOrElse([]))
    );

    return h('div', [
        h('.container', [
            svg('svg', { width: outerWidth, height: outerHeight }, [
                svg('g', { transform: `translate(${margin.left},${margin.top})` }, [
                    svg('g', { class: 'x axis', transform: `translate(0,${height})` }, [ xAxisVNode ]),
                    svg('g', revisions.map(createRevision)),
                    createMasks(),
                    createHeadLine(),
                    createBaseLine(),
                    baseMode ? createBaseLine(true) : createHeadLine(true),
                    svg('rect', {
                        class: 'overlay',
                        width: String(outerWidth - margin.left - margin.right),
                        height: String(outerHeight),
                        onmousemove: (event: MouseEvent) => {
                            const { offsetX } = event;
                            focusOffsetXSubject.onNext(Option(offsetX))
                        },
                        onclick: (event: MouseEvent) => {
                            if (baseMode) {
                                const { offsetX } = event;
                                const date = xScale.invert(offsetX);
                                baseSubject.onNext(Option(date));
                            } else {
                                const { offsetX } = event;
                                const date = xScale.invert(offsetX);
                                headSubject.onNext(Option(date));
                            }
                        },
                        onmouseleave: () => focusOffsetXSubject.onNext(None)
                    }, [])
                ])
            ]),
            maybeTooltipOffsetX
                .flatMap(tooltipOffsetX => (
                    maybeTooltipRevisions
                        .map((revisions): VNode | undefined => (
                            h('ul.tooltip', {
                                style: { transform: `translate(${tooltipOffsetX + margin.left - Math.floor(lineWidth / 2)}px)` },
                                onmouseenter: () => tooltipHoverSubject.onNext(true),
                                onmouseleave: () => tooltipHoverSubject.onNext(false)
                            }, revisions.map(revision => h('li', JSON.stringify(revision, null, ' '))))
                        ))
                ))
                .getOrElse(undefined)
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
