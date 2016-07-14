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

interface State {
    baseMode: boolean
    maybeHead: Option<Date>
    maybeBase: Option<Date>
    maybeFocus: Option<number>
}

const rint = (n: number) => (Math.random() * (n + 1)) | 0;
const rdate = (): Date => new Date(2016, rint(11), rint(28), rint(23));
const revisions: Revision[] = range(0, 30).map((x, id) => ({
    id,
    datasetSlug: 'fraud',
    createdAt: rdate(),
    authorName: 'Bob'
}))

console.log(JSON.stringify(revisions, null, '\t'));

//
// Observables and subjects
//

const resetSubject = new Subject<boolean>()
const baseModeSubject = new Subject<boolean>()
const baseSubject = new Subject<Option<Date>>()
const headSubject = new Subject<Option<Date>>()
const focusSubject = new Subject<Option<number>>()

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
const focus$: Observable<Option<number>> = Observable.merge(focusSubject, resetSubject.map(x => None))
    .startWith(None);

const state$: Observable<State> = Observable.combineLatest(
    baseMode$, head$, base$, focus$,
    (baseMode, maybeHead, maybeBase, maybeFocus) => ({ baseMode, maybeHead, maybeBase, maybeFocus }))

//
// Rendering
//

const radius = 15;
const margin = {top: 0, right: radius, bottom: 30, left: radius};
const outerWidth = 700;
const outerHeight = 100;
const width = outerWidth - margin.left - margin.right;
const height = outerHeight - margin.top - margin.bottom;

const xScale = d3.time.scale()
    .domain(d3.extent(revisions.map(d => d.createdAt.getTime())))
    .range([0, width]);

const xAxis = d3.svg.axis()
    .scale(xScale)
    .ticks(d3.time.month)
    .tickFormat(d3.time.format('%m'));

const svgns = "http://www.w3.org/2000/svg";
const d3AxisToElement = (d3Axis: d3.svg.Axis): Element => (
    <Element>d3.select(document.createElementNS(svgns, 'svg'))
        .call(xAxis)
        .node()
);
const xAxisVNode = virtualize(d3AxisToElement(xAxis));

const lineWidth = 3;
const getRevisionsFor = (x: number): Revision[] => (
    revisions.filter(d => {
        const x2 = xScale(d.createdAt);
        const xLowerBound = x2 - radius;
        const xUpperBound = x2 + radius;
        return inRange(x - (lineWidth / 2), xLowerBound, xUpperBound)
            || inRange(x + (lineWidth / 2), xLowerBound, xUpperBound);
    })
);

const createVirtualMarker = (className: string, translateX: number, shouldHide: boolean, label: string, invertMarker: boolean): VNode => (
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

const render = (state: State) => {
    console.log('render', state);

    const focusedRevisions = state.maybeFocus.map(getRevisionsFor).getOrElse([]);
    const selectedRevisions = state.maybeBase.flatMap(base => (
        state.maybeHead.map(head => (
            revisions.filter(d => d.createdAt > base && d.createdAt < head)
        ))
    )).getOrElse([])

    const createHeadLine = (isFocusLine: boolean = false) => (
        createVirtualMarker(
            ['head-line', isFocusLine ? 'focus-line' : ''].filter(identity).join(' '),
            isFocusLine ? state.maybeFocus.getOrElse(0) : state.maybeHead.map(d => xScale(d)).getOrElse(0),
            isFocusLine ? state.maybeFocus.isEmpty : state.maybeHead.isEmpty,
            'Head',
            false
        )
    );

    const createBaseLine = (isFocusLine: boolean = false) => (
        createVirtualMarker(
            ['base-line', isFocusLine ? 'focus-line' : ''].filter(identity).join(' '),
            isFocusLine ? state.maybeFocus.getOrElse(0) : state.maybeBase.map(d => xScale(d)).getOrElse(0),
            isFocusLine ? state.maybeFocus.isEmpty : state.maybeBase.isEmpty,
            'Base',
            true
        )
    );

    return h('div', [
        h('h1', 'Tardis'),
        svg('svg', { width: outerWidth, height: outerHeight }, [
            svg('g', { transform: `translate(${margin.left},${margin.top})` }, [
                svg('g', { class: 'x axis', transform: `translate(0,${height})` }, [ xAxisVNode ]),
                svg('g', revisions.map(revision => (
                    svg('circle', { class: 'dot', r: String(radius), cx: String(xScale(revision.createdAt)), cy: String(height / 2) }, [
                        svg('title', [ String(revision.id) ])
                    ])
                ))),
                createHeadLine(),
                createBaseLine(),
                state.baseMode ? createBaseLine(true) : createHeadLine(true),
                svg('rect', {
                    class: 'overlay',
                    width: String(outerWidth),
                    height: String(outerHeight),
                    onmousemove: (event: MouseEvent) => {
                        const x = event.offsetX;
                        focusSubject.onNext(Option(x))
                    },
                    onclick: (event: MouseEvent) => {
                        if (state.baseMode) {
                            const x = event.offsetX;
                            const date = xScale.invert(x);
                            baseSubject.onNext(Option(date));
                        } else {
                            const x = event.offsetX;
                            const date = xScale.invert(x);
                            headSubject.onNext(Option(date));
                        }
                    }
                }, [])
            ])
        ]),
        h('div', [
            h('button', { onclick: (event: MouseEvent) => resetSubject.onNext(true) }, [ 'Reset' ]),
            h('label', [
                h('input', {
                    onchange: (event: Event) => baseModeSubject.onNext((event.target as HTMLInputElement).checked),
                    type: 'checkbox',
                    checked: state.baseMode
                }, []),
                'Select base'
            ])
        ]),
        h('div', [
            h('p', `Version of dataset (head): ${state.maybeHead.map(head => String(head.getTime())).getOrElse('')}`),
            h('p', `Show changes since (base): ${state.maybeBase.map(base => String(base.getTime())).getOrElse('')}`),
            h('h2', 'Selected revisions'),
            h('ul', selectedRevisions.map(revision => h('li', JSON.stringify(revision, null, '\t')))),
            h('h2', 'Focused revisions'),
            h('ul', focusedRevisions.map(revision => h('li', JSON.stringify(revision, null, '\t')))),
        ])
    ]);
};

let tree: VNode, rootNode: Element;
state$
    .map(render)
    .subscribe(newTree => {
        if (!rootNode) {
            rootNode = create(newTree);
            document.body.appendChild(rootNode);
        }
        const patches = diff(tree || newTree, newTree);
        rootNode = patch(rootNode, patches);
        tree = newTree;
    });
