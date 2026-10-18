export type FieldName =
  "firstName" | "lastName" | "email" | "password" | "confirmPassword";

export type Errors = Partial<Record<FieldName, string>>;
