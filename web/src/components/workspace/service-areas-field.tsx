"use client";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

function initialAreas(value: string | null) {
  const savedAreas = value
    ?.split(/\r?\n/)
    .map((area) => area.trim())
    .filter(Boolean);

  return savedAreas?.length ? savedAreas : [""];
}

export function ServiceAreasField({
  id,
  value,
  label = "Areas you serve",
  required = false,
  description,
}: {
  id: string;
  value: string | null;
  label?: string;
  required?: boolean;
  description: string;
}) {
  const [areas, setAreas] = useState(() => initialAreas(value));
  const serializedAreas = areas
    .map((area) => area.trim())
    .filter(Boolean)
    .join("\n");

  function updateArea(index: number, value: string) {
    const nextAreas = areas.map((area, areaIndex) =>
      areaIndex === index ? value : area,
    );
    const nextSerialized = nextAreas
      .map((area) => area.trim())
      .filter(Boolean)
      .join("\n");

    if (nextSerialized.length <= 200) setAreas(nextAreas);
  }

  return (
    <Field>
      <FieldLabel htmlFor={`${id}-0`}>{label}</FieldLabel>
      <div className="flex flex-col gap-2">
        {areas.map((area, index) => {
          const otherAreasLength = areas
            .filter((_, areaIndex) => areaIndex !== index)
            .map((item) => item.trim())
            .filter(Boolean)
            .join("\n").length;
          const maxLength = Math.max(
            0,
            200 - otherAreasLength - (otherAreasLength ? 1 : 0),
          );
          const anotherAreaIsFilled = areas.some(
            (item, areaIndex) => areaIndex !== index && item.trim().length > 0,
          );

          return (
            <div key={`${id}-${index}`} className="flex items-center gap-2">
              <Input
                id={`${id}-${index}`}
                aria-label={`Service area ${index + 1}`}
                value={area}
                required={required && index === 0 && !anotherAreaIsFilled}
                maxLength={maxLength}
                onChange={(event) =>
                  updateArea(index, event.currentTarget.value)
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove service area ${index + 1}`}
                onClick={() =>
                  setAreas((current) => {
                    const next = current.filter(
                      (_, areaIndex) => areaIndex !== index,
                    );

                    return next.length ? next : [""];
                  })
                }
              >
                <Trash2Icon />
              </Button>
            </div>
          );
        })}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => setAreas((current) => [...current, ""])}
        >
          <PlusIcon data-icon="inline-start" />
          Add area
        </Button>
      </div>
      <input type="hidden" name="serviceArea" value={serializedAreas} />
      <FieldDescription>
        {description} Up to 200 characters total.
      </FieldDescription>
    </Field>
  );
}
