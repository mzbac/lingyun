type ChatControllerMethod<TController extends object> = (this: TController, ...args: any[]) => any;

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

  for (const [name, method] of Object.entries(methods) as Array<[keyof T, T[keyof T]]>) {
    bound[name] = method.bind(controller) as BoundChatControllerService<TController, T>[keyof T];
  }

  return bound;
}
