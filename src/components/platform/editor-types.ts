export type EditorField = {
  name: string;
  label: string;
  placeholder?: string;
  description?: string;
  emptyMessage?: string;
  type?:
    | "text"
    | "email"
    | "number"
    | "date"
    | "time"
    | "textarea"
    | "select"
    | "multi";
  value?: string | number | string[];
  options?: { value: string; label: string }[];
  required?: boolean;
  min?: number;
  max?: number;
  maxLength?: number;
  step?: number;
};
