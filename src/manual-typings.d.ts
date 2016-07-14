declare module 'vdom-virtualize' {
    function main(node: Node): VirtualDOM.VNode;

    export = main;
}
declare module 'virtual-dom/virtual-hyperscript/svg' {
    import h = VirtualDOM.h;
    export = h;
}
