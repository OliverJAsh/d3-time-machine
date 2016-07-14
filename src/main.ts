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
    baselineMode: boolean
    maybeActive: Option<Date>
    maybeBaseline: Option<Date>
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
const baselineModeSubject = new Subject<boolean>()
const baselineSubject = new Subject<Option<Date>>()
const activeSubject = new Subject<Option<Date>>()
const focusSubject = new Subject<Option<number>>()

const inputActive$: Observable<Option<Date>> = Observable.merge(activeSubject, resetSubject.map(x => None))
    .startWith(None)
const inputBaseline$: Observable<Option<Date>> = Observable.merge(
    baselineSubject,
    resetSubject.map(x => None)
)
    .startWith(None);
const baselineMode$: Observable<boolean> = Observable.merge(
    baselineModeSubject,
    resetSubject.map(x => false),
    inputBaseline$.map(x => false)
)
    .startWith(false);

const baseline$: Observable<Option<Date>> = Observable.combineLatest(inputBaseline$, inputActive$)
    .withLatestFrom(baselineMode$)
    .scan((maybeCurrentBaseline, [ [ maybeInputBaseline, maybeInputActive ], baselineMode ]) => (
        baselineMode
            ? maybeInputBaseline
            : maybeCurrentBaseline.flatMap(currentBaseline => (
                maybeInputActive.map(inputActive => inputActive < currentBaseline ? inputActive : currentBaseline)
            ))
    ), None as Option<Date>)
const active$: Observable<Option<Date>> = Observable.combineLatest(inputActive$, inputBaseline$)
    .withLatestFrom(baselineMode$)
    .scan((maybeCurrentActive, [ [ maybeInputActive, maybeInputBaseline ], baselineMode ]) => (
        baselineMode
            ? maybeCurrentActive.flatMap(currentActive => (
                maybeInputBaseline.map(inputBaseline => inputBaseline > currentActive ? inputBaseline : currentActive)
            ))
            : maybeInputActive
    ), None as Option<Date>)
const focus$: Observable<Option<number>> = Observable.merge(focusSubject, resetSubject.map(x => None))
    .startWith(None);

const state$: Observable<State> = Observable.combineLatest(
    baselineMode$, active$, baseline$, focus$,
    (baselineMode, maybeActive, maybeBaseline, maybeFocus) => ({ baselineMode, maybeActive, maybeBaseline, maybeFocus }))

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

const createVirtualLine = (classNames: string[], translateX: number, shouldHide: boolean): VNode => (
    svg('line', {
        class: classNames.join(' '),
        attributes: { 'stroke-width': String(lineWidth) },
        y1: 0,
        y2: outerHeight - margin.bottom,
        transform: `translate(${translateX})`,
        style: { display: shouldHide ? 'none' : '' }
    }, [])
);

const render = (state: State) => {
    console.log('render', state);

    const focusedRevisions = state.maybeFocus.map(getRevisionsFor).getOrElse([]);

    return h('div', [
        svg('svg', { width: outerWidth, height: outerHeight }, [
            svg('g', { transform: `translate(${margin.left},${margin.top})` }, [
                svg('g', { class: 'x axis', transform: `translate(0,${height})` }, [ xAxisVNode ]),
                svg('g', revisions.map(revision => (
                    svg('circle', { class: 'dot', r: String(radius), cx: String(xScale(revision.createdAt)), cy: String(height / 2) }, [
                        svg('title', [ String(revision.id) ])
                    ])
                ))),
                createVirtualLine(
                    ['active-line'],
                    state.maybeActive.map(d => xScale(d)).getOrElse(0),
                    state.maybeActive.isEmpty
                ),
                createVirtualLine(
                    ['baseline-line'],
                    state.maybeBaseline.map(d => xScale(d)).getOrElse(0),
                    state.maybeBaseline.isEmpty
                ),
                createVirtualLine(
                    ['focus-line', state.baselineMode ? 'baseline-mode' : ''].filter(identity),
                    state.maybeFocus.getOrElse(0),
                    state.maybeFocus.isEmpty
                ),
                svg('rect', {
                    class: 'overlay',
                    width: String(outerWidth),
                    height: String(outerHeight),
                    onmousemove: (event: MouseEvent) => {
                        const x = event.offsetX;
                        focusSubject.onNext(Option(x))
                    },
                    onclick: (event: MouseEvent) => {
                        if (state.baselineMode) {
                            const x = event.offsetX;
                            const date = xScale.invert(x);
                            baselineSubject.onNext(Option(date));
                        } else {
                            const x = event.offsetX;
                            const date = xScale.invert(x);
                            activeSubject.onNext(Option(date));
                        }
                    }
                }, [])
            ])
        ]),
        h('div', [
            h('button', { onclick: (event: MouseEvent) => resetSubject.onNext(true) }, [ 'Reset' ]),
            h('label', [
                h('input', {
                    onchange: (event: Event) => baselineModeSubject.onNext((event.target as HTMLInputElement).checked),
                    type: 'checkbox',
                    checked: state.baselineMode
                }, []),
                'Select baseline'
            ])
        ]),
        h('div', [
            h('p', `Active: ${state.maybeActive.map(active => String(active.getTime())).getOrElse('')}`),
            h('p', `Baseline: ${state.maybeBaseline.map(baseline => String(baseline.getTime())).getOrElse('')}`),
            h('ul', focusedRevisions.map(revision => h('li', JSON.stringify(revision, null, '\t'))))
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
