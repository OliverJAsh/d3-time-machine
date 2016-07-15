declare module 'vdom-virtualize' {
    function main(node: Node): VirtualDOM.VNode;

    export = main;
}
declare module 'virtual-dom/virtual-hyperscript/svg' {
    import h = VirtualDOM.h;
    export = h;
}
declare namespace Rx {
    interface ObservableStatic {
        combineLatest<T, T2, T3, T4, T5, T6>(first: Observable<T>|IPromise<T>, second: Observable<T2>|IPromise<T2>, third: Observable<T3>|IPromise<T3>, fourth: Observable<T4>|IPromise<T4>, fifth: Observable<T5>|IPromise<T5>, sixth: Observable<T6>|IPromise<T6>): Observable<[T, T2, T3, T4, T5, T6]>;
        combineLatest<T, T2, T3, T4, T5, T6, T7>(first: Observable<T>|IPromise<T>, second: Observable<T2>|IPromise<T2>, third: Observable<T3>|IPromise<T3>, fourth: Observable<T4>|IPromise<T4>, fifth: Observable<T5>|IPromise<T5>, sixth: Observable<T6>|IPromise<T6>, seventh: Observable<T7>|IPromise<T7>): Observable<[T, T2, T3, T4, T5, T6, T7]>;
    }
}
