import { SearchIcon } from "lucide-react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";

export function SearchField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <InputGroup className="max-w-xs">
      <InputGroupAddon>
        <InputGroupText>
          <SearchIcon aria-hidden="true" />
          Search
        </InputGroupText>
      </InputGroupAddon>
      <InputGroupInput
        type="search"
        aria-label={label}
        placeholder="Search…"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </InputGroup>
  );
}
