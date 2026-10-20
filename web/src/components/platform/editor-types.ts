type FieldBase = {
  name: string;
  label: string;
  autoComplete?: string;
  description?: string;
  emptyMessage?: string;
  placeholder?: string;
  required?: boolean;
  min?: number;
  max?: number;
  maxLength?: number;
  step?: number;
};

type FieldOption = { value: string; label: string };

export type EditorField = FieldBase &
  (
    | {
        type?: "text" | "email" | "number" | "date" | "time" | "textarea";
        value?: string | number;
      }
    | { type: "select"; value?: string | number; options: FieldOption[] }
    | {
        type: "multi" | "multi-select";
        value?: string[];
        options: FieldOption[];
      }
  );
