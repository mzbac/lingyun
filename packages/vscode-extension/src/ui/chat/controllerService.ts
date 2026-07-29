type ChatControllerMethod<
  TController extends object,
  TArgs extends unknown[] = never[],
  TResult = unknown,
> = (this: TController, ...args: TArgs) => TResult;

export type BoundChatControllerService<
  TController extends object,
  T extends Record<string, ChatControllerMethod<TController>>,
> = {
  [K in keyof T]: T[K] extends (this: TController, ...args: infer A) => infer R
    ? (...args: A) => R
    : never;
};

export function bindChatControllerService<
  TController extends object,
  T extends Record<string, ChatControllerMethod<TController>>,
>(
  controller: TController,
  methods: T
): BoundChatControllerService<TController, T> {
  const bound = {} as BoundChatControllerService<TController, T>;

  for (const name in methods) {
    if (!Object.prototype.hasOwnProperty.call(methods, name)) continue;
    const key = name as keyof T;
    const method = methods[key];
    bound[key] = method.bind(controller) as BoundChatControllerService<TController, T>[keyof T];
  }

  return bound;
}
