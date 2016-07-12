import * as d3 from 'd3';
import { range, inRange } from 'lodash';
import { Subject, Observable } from 'rx-lite';

interface Revision {
    id: number
    datasetSlug: string
    createdAt: Date
    authorName: string
}

interface State {
    baselineMode: boolean
    active: Date
    baseline: Date
    focus: number
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
const baselineSubject = new Subject<Date>()
const activeSubject = new Subject<Date>()
const focusSubject = new Subject<number>()

const inputActive$: Observable<Date> = Observable.merge(activeSubject, resetSubject.map(x => undefined))
    .startWith(undefined)
const inputBaseline$: Observable<Date> = Observable.merge(baselineSubject, resetSubject.map(x => undefined))
    .startWith(undefined);
const baselineMode$: Observable<boolean> = Observable.merge(
    baselineModeSubject,
    resetSubject.map(x => false),
    inputBaseline$.map(x => false)
)
    .startWith(false);

const baseline$: Observable<Date> = Observable.combineLatest(inputBaseline$, inputActive$)
    .withLatestFrom(baselineMode$)
    .scan((currentBaseline, [ [ inputBaseline, inputActive ], baselineMode ]) => (
        baselineMode
            ? inputBaseline
            : inputActive && (inputActive < currentBaseline ? inputActive : currentBaseline)
    ), undefined as Date)
const active$: Observable<Date> = Observable.combineLatest(inputActive$, inputBaseline$)
    .withLatestFrom(baselineMode$)
    .scan((currentActive, [ [ inputActive, inputBaseline ], baselineMode ]) => (
        baselineMode
            ? inputBaseline && (inputBaseline > currentActive ? inputBaseline : currentActive)
            : inputActive
    ), undefined as Date)
const focus$ = Observable.merge(focusSubject, resetSubject.map(x => undefined)).startWith(undefined)

//
// Initial render
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

const bodySelection = d3.select('body')
const svgSelection = bodySelection
    .append('svg')
    .attr('width', outerWidth)
    .attr('height', outerHeight)
    .append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

svgSelection.append('g')
    .attr('class', 'x axis')
    .attr('transform', `translate(0,${height})`)
    .call(xAxis);

// Circles
svgSelection.append('g')
    .selectAll('.dot')
    .data(revisions)
    .enter()
    .append('circle')
    .attr('class', 'dot')
    .attr('r', radius)
    .attr('cx', d => xScale(d.createdAt))
    .attr('cy', height / 2)
    .append('title')
    .text(d => d.id)

const lineWidth = 3;
const createLine = (): d3.Selection<any> => (
    svgSelection.append('line')
        .attr('stroke-width', lineWidth)
        .attr('y1', 0)
        .attr('y2', outerHeight - margin.bottom)
);

const activeLineSelection = createLine().attr('class', 'active-line');
const baselineLineSelection = createLine().attr('class', 'baseline-line');
const focusLineSelection = createLine().attr('class', 'focus-line');

const interactionRectSelection = svgSelection
    .append('rect');

const interactionRectEl = interactionRectSelection.node();
interactionRectSelection
    .classed('overlay', true)
    .attr('width', outerWidth)
    .attr('height', outerHeight)
    .on('mousemove', () => {
        const [x] = d3.mouse(interactionRectEl);
        focusSubject.onNext(x)
    })

const toolbarSelection = bodySelection.append('div');

toolbarSelection.append('button')
    .text('Reset')
    .on('click', () => resetSubject.onNext(true))

const baselineCheckboxLabelSelection = toolbarSelection.append('label')
baselineCheckboxLabelSelection.append('span').text('Select baseline');
const baselineCheckboxSelection = baselineCheckboxLabelSelection
    .append('input')

baselineCheckboxSelection
    .attr('type', 'checkbox')
    .on('change', () => baselineModeSubject.onNext(baselineCheckboxSelection.property('checked')))

const activeSelection = bodySelection.append('p')
const baselineSelection = bodySelection.append('p')
const focusedRevisionsSelection = bodySelection.append('ul')

const state$: Observable<State> = Observable.combineLatest(
    baselineMode$, active$, baseline$, focus$,
    (baselineMode, active, baseline, focus) => ({ baselineMode, active, baseline, focus }))

const getRevisionsFor = (x: number): Revision[] => (
    revisions.filter(d => {
        const x2 = xScale(d.createdAt);
        const xLowerBound = x2 - radius;
        const xUpperBound = x2 + radius;
        return inRange(x - (lineWidth / 2), xLowerBound, xUpperBound)
            || inRange(x + (lineWidth / 2), xLowerBound, xUpperBound);
    })
);

const render = (state: State) => {
    console.log('render', state);

    baselineCheckboxSelection.property('checked', state.baselineMode);

    activeLineSelection
        .attr('transform', state.active && `translate(${xScale(state.active)})`)
        .style('display', state.active ? '' : 'none')

    baselineLineSelection
        .attr('transform', state.baseline && `translate(${xScale(state.baseline)})`)
        .style('display', state.baseline ? '' : 'none')

    focusLineSelection
        .attr('transform', state.focus && `translate(${state.focus})`)
        .style('display', state.focus ? '' : 'none')
        .classed('baseline-mode', state.baselineMode)

    interactionRectSelection.on('click', () => {
        if (state.baselineMode) {
            const [x] = d3.mouse(interactionRectEl);
            const date = xScale.invert(x);
            baselineSubject.onNext(date);
        } else {
            const [x] = d3.mouse(interactionRectEl);
            const date = xScale.invert(x);
            activeSubject.onNext(date);
        }
    });

    activeSelection.text(`Active: ${state.active && state.active.getTime()}`)
    baselineSelection.text(`Baseline: ${state.baseline && state.baseline.getTime()}`)

    focusedRevisionsSelection.html(getRevisionsFor(state.focus)
        .map(revision => `<li>${JSON.stringify(revision, null, '\t')}</li>`)
        .join(''))
};

state$.subscribe(render);
