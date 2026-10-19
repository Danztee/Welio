export type EditorField = {
  name: string;
  label: string;
  autoComplete?: string;
  description?: string;
  emptyMessage?: string;
  placeholder?: string;
  type?:
    | "text"
    | "email"
    | "number"
    | "date"
    | "time"
    | "textarea"
    | "select"
    | "multi"
    | "multi-select";
  value?: string | number | string[];
  options?: { value: string; label: string }[];
  required?: boolean;
  min?: number;
  max?: number;
  maxLength?: number;
  step?: number;
};
