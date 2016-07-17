import * as d3 from 'd3';
import { range, inRange } from 'lodash';
import { Subject, Observable } from 'rx-lite';
import { Option, None } from './option';

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

const lineWidth = 3;

const state$: Observable<State> = Observable.combineLatest(
    baselineMode$, active$, baseline$, focus$,
    (baselineMode, maybeActive, maybeBaseline, maybeFocus) => ({ baselineMode, maybeActive, maybeBaseline, maybeFocus }))

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

    const mainGroupSelectionUpdate = d3.select('body').selectAll('svg').data([1]);
    const mainGroupSelectionEnter = mainGroupSelectionUpdate
        .enter()
        .append('svg')
        .attr('width', outerWidth)
        .attr('height', outerHeight);

    mainGroupSelectionEnter
        .append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);

    mainGroupSelectionEnter
        .append('g')
        .attr('class', 'x axis')
        .attr('transform', `translate(0,${height})`)
        .call(xAxis);

    //
    // Circles
    //

    mainGroupSelectionEnter
        .append('g')
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

    //
    // Lines
    //

    const linesSelectionUpdate = mainGroupSelectionUpdate.selectAll('.lines').data([1]);

    // Enter
    const linesSelectionEnter = linesSelectionUpdate.enter().append('g').classed('lines', true);
    const appendLine = (): d3.Selection<any> => (
        linesSelectionEnter.append('line')
            .attr('stroke-width', lineWidth)
            .attr('y1', 0)
            .attr('y2', outerHeight - margin.bottom)
    );

    appendLine().attr('class', 'active-line');
    appendLine().attr('class', 'baseline-line');
    appendLine().attr('class', 'focus-line');

    // Enter + update
    linesSelectionUpdate.select('.active-line')
        .attr('transform', state.maybeActive.map(active => `translate(${xScale(active)})`).getOrElse(''))
        .style('display', state.maybeActive.isEmpty ? 'none' : '')

    linesSelectionUpdate.select('.baseline-line')
        .attr('transform', state.maybeBaseline.map(baseline => `translate(${xScale(baseline)})`).getOrElse(''))
        .style('display', state.maybeBaseline.isEmpty ? 'none' : '')

    linesSelectionUpdate.select('.focus-line')
        .attr('transform', state.maybeFocus.map(focus => `translate(${focus})`).getOrElse(''))
        .style('display', state.maybeFocus.isEmpty ? 'none' : '')
        .classed('baseline-mode', state.baselineMode);

    //
    // Interaction rect
    //

    const interactionRectSelectionUpdate = mainGroupSelectionUpdate
        .selectAll('.overlay')
        .data([1]);

    // Enter
    const interactionRectSelectionEnter = interactionRectSelectionUpdate.enter()
    interactionRectSelectionEnter
        .append('rect')
        .classed('overlay', true)
        .attr('width', outerWidth)
        .attr('height', outerHeight)
        .on('mousemove', () => {
            const [x] = d3.mouse(interactionRectSelectionUpdate.node());
            focusSubject.onNext(Option(x))
        });

    // Enter + update
    interactionRectSelectionUpdate.on('click', () => {
        if (state.baselineMode) {
            const [x] = d3.mouse(interactionRectSelectionUpdate.node());
            const date = xScale.invert(x);
            baselineSubject.onNext(Option(date));
        } else {
            const [x] = d3.mouse(interactionRectSelectionUpdate.node());
            const date = xScale.invert(x);
            activeSubject.onNext(Option(date));
        }
    })

    //
    // Toolbar
    //

    const bodySelection = d3.select('body');
    const toolbarSelection = bodySelection.selectAll('.toolbar').data([1]);

    // Enter
    const toolbarSelectionEnter = toolbarSelection.enter()
        .append('div')
        .classed('toolbar', true);

    toolbarSelectionEnter.append('button')
        .text('Reset')
        .on('click', () => resetSubject.onNext(true))

    const baselineCheckboxLabelSelection = toolbarSelectionEnter.append('label')
    baselineCheckboxLabelSelection.append('span').text('Select baseline');
    const baselineCheckboxSelection = baselineCheckboxLabelSelection
        .append('input')

    baselineCheckboxSelection
        .attr('type', 'checkbox')
        .on('change', () => baselineModeSubject.onNext(baselineCheckboxSelection.property('checked')))

    // Enter + update
    // TODO: Why can't I re-use the input selection above?
    const baselineCheckboxSelectionUpdate = toolbarSelection.select('input');
    baselineCheckboxSelectionUpdate
        .property('checked', state.baselineMode);

    //
    // Output
    //

    const outputSelection = bodySelection.selectAll('.output').data([1]);

    // Enter
    const outputSelectionEnter = outputSelection.enter().append('div').classed('output', true);

    outputSelectionEnter.append('p').classed('active', true);
    outputSelectionEnter.append('p').classed('baseline', true);
    outputSelectionEnter.append('ul').classed('focused-revisions', true);

    // Enter + update
    outputSelection.select('.active')
        .text(`Active: ${state.maybeActive
        .map(active => String(active.getTime())).getOrElse('')}`)
    outputSelection.select('.baseline')
        .text(`Baseline: ${state.maybeBaseline
        .map(baseline => String(baseline.getTime())).getOrElse('')}`)
    const focusedRevisions = state.maybeFocus.map(getRevisionsFor).getOrElse([]);
    outputSelection.select('.focused-revisions')
        .html(
            focusedRevisions
            .map(revision => `<li>${JSON.stringify(revision, null, '\t')}</li>`)
            .join('')
        );
};

state$.subscribe(render);
