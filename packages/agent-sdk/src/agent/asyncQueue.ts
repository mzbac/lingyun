type AsyncQueueState<T> = {
  values: T[];
  resolvers: Array<(value: IteratorResult<T>) => void>;
  rejecters: Array<(error: unknown) => void>;
  closed: boolean;
  error?: unknown;
};

export class AsyncQueue<T> implements AsyncIterable<T> {
  private state: AsyncQueueState<T> = {
    values: [],
    resolvers: [],
    rejecters: [],
    closed: false,
  };

  push(value: T): void {
    if (this.state.closed) return;
    const resolver = this.state.resolvers.shift();
    const rejecter = this.state.rejecters.shift();
    if (resolver && rejecter) {
      resolver({ value, done: false });
      return;
    }
    this.state.values.push(value);
  }

  close(): void {
    if (this.state.closed) return;
    this.state.closed = true;
    for (const resolve of this.state.resolvers) {
      resolve({ value: undefined as any, done: true });
    }
    this.state.resolvers = [];
    this.state.rejecters = [];
  }

  fail(error: unknown): void {
    if (this.state.closed) return;
    this.state.closed = true;
    this.state.error = error;
    for (const reject of this.state.rejecters) {
      reject(error);
    }
    this.state.resolvers = [];
    this.state.rejecters = [];
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.state.error) {
          return Promise.reject(this.state.error);
        }
        const value = this.state.values.shift();
        if (value !== undefined) {
          return Promise.resolve({ value, done: false });
        }
        if (this.state.closed) {
          return Promise.resolve({ value: undefined as any, done: true });
        }
        return new Promise<IteratorResult<T>>((resolve, reject) => {
          this.state.resolvers.push(resolve);
          this.state.rejecters.push(reject);
        });
      },
      return: () => {
        this.close();
        return Promise.resolve({ value: undefined as any, done: true });
      },
      throw: (error) => {
        this.fail(error);
        return Promise.reject(error);
      },
    };
  }
}

