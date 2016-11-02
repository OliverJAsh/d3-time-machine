// Based on https://github.com/jiaweihli/monapt/blob/master/src/option.ts

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

    map<B>(f: (value: A) => B): Option<B> {
        return None;
    }

    flatMap<B>(f: (value: A) => Option<B>): Option<B> {
        return None;
    }

    filter(predicate: (value: A) => boolean): Option<A> {
        return this;
    }
}

export const None: Option<never> = new NoneImpl<never>();

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

    map<B>(f: (value: A) => B): Option<B>;
    flatMap<B>(f: (value: A) => Option<B>): Option<B>;

    filter(predicate: (value: A) => boolean): Option<A>;
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
}

export const flatten = <A>(options: Option<A>[]): A[] => (
	options.filter(option => option.isDefined).map(option => option.get())
);

