import type * as Contract from "./generated/types.gen";

type CamelKey<S extends string> = S extends `${infer A}_${infer B}`
  ? `${A}${Capitalize<CamelKey<B>>}`
  : S;
export type CamelFields<T> = T extends readonly (infer U)[]
  ? CamelFields<U>[]
  : T extends object
    ? {
        [K in keyof T as K extends string ? CamelKey<K> : K]: CamelFields<T[K]>;
      }
    : T;

type Models = {
  Customer: Contract.Customer;
  User: Contract.User;
  Session: Contract.Session;
  AuthResult: Contract.AuthResult;
  Appointment: Contract.Appointment;
};
export type APIModel<Name extends keyof Models> = CamelFields<Models[Name]>;
