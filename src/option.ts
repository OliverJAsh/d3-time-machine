export class NoSuchElementError extends Error {
    public name: string;
    public message: string;
    public stack: string | undefined;

    constructor() {
        super('No such element.');

        this.name = 'NoSuchElementError';
        this.message = 'No such element.';
        this.stack = new Error().stack;
    }
}

class NoneImpl<A> implements Option<A> {
    isDefined = false;
    isEmpty = true;

    get(): A {
        throw new NoSuchElementError();
    }

    getOrElse(defaultValue: A): A {
        return defaultValue;
    }

    orElse(alternative: Option<A>): Option<A> {
        return alternative;
    }

    match<B>(matcher: IOptionMatcher<A, B>): B {
        return matcher.None();
    }

    map<B>(f: (value: A) => B): Option<B> {
        return None;
    }

    flatMap<B>(f: (value: A) => Option<B>): Option<B> {
        return None;
    }

    filter(predicate: (value: A) => boolean): Option<A> {
        return this;
    }

    reject(predicate: (value: A) => boolean): Option<A> {
        return this;
    }

    foreach(f: (value: A) => void) {
        return;
    }
}

export const None: Option<any> = new NoneImpl<any>();

export interface IOptionMatcher<A, B> {
    Some(value: A): B;
    None(): B;
}

export const Option = <T>(value: T): Option<T> => {
    if (typeof value !== 'undefined' && value !== null) {
        return new Some(value);
    } else {
        return None;
    }
};

export interface Option<A> {
    isDefined: boolean;
    isEmpty: boolean;

    get(): A;
    getOrElse(defaultValue: A): A;
    orElse(alternative: Option<A>): Option<A>;

    match<B>(matcher: IOptionMatcher<A, B>): B;

    map<B>(f: (value: A) => B): Option<B>;
    flatMap<B>(f: (value: A) => Option<B>): Option<B>;

    filter(predicate: (value: A) => boolean): Option<A>;
    reject(predicate: (value: A) => boolean): Option<A>;

    foreach(f: (value: A) => void): void;
}

export class Some<A> implements Option<A> {
    isDefined = true;
    isEmpty = false;

    constructor(private value :A) { }

    get(): A {
        return this.value;
    }

    getOrElse(defaultValue: A): A {
        return this.value;
    }

    orElse(alternative: Option<A>): Option<A> {
        return this;
    }

    match<B>(matcher: IOptionMatcher<A, B>): B {
        return matcher.Some(this.value);
    }

    map<B>(f: (value: A) => B): Option<B> {
        return new Some<B>(f(this.get()));
    }

    flatMap<B>(f: (value: A) => Option<B>): Option<B> {
        return f(this.get());
    }

    filter(predicate: (value: A) => boolean): Option<A> {
        if (predicate(this.value)) {
            return this;
        }
        else {
            return None;
        }
    }

    reject(predicate: (value: A) => boolean): Option<A> {
        return this.filter(v => !predicate(v));
    }

    foreach(f: (value: A) => void) {
        f(this.value);
    }

}
