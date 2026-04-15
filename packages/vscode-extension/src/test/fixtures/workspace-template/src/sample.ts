const fixtureValue = 1;

export function foo(): number {
  return fixtureValue;
}

export function helloGrep(): number {
  return foo();
}

export class Bar {
  method(): number {
    return helloGrep();
  }
}
