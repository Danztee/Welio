"use client";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

type ServiceArea = { id: string; value: string };

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
  const [areas, setAreas] = useState<ServiceArea[]>(() =>
    initialAreas(value).map((area, index) => ({
      id: `${id}-saved-${index}`,
      value: area,
    })),
  );
  const serializedAreas = areas
    .map(({ value }) => value.trim())
    .filter(Boolean)
    .join("\n");

  function updateArea(id: number, value: string) {
    const nextAreas = areas.map((area) =>
      area.id === id ? { ...area, value } : area,
    );
    const nextSerialized = nextAreas
      .map(({ value }) => value.trim())
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
            .filter((item) => item.id !== area.id)
            .map(({ value }) => value.trim())
            .filter(Boolean)
            .join("\n").length;
          const maxLength = Math.max(
            0,
            200 - otherAreasLength - (otherAreasLength ? 1 : 0),
          );
          const anotherAreaIsFilled = areas.some(
            (item) => item.id !== area.id && item.value.trim().length > 0,
          );

          return (
            <div key={area.id} className="flex items-center gap-2">
              <Input
                id={`${id}-${index}`}
                aria-label={`Service area ${index + 1}`}
                value={area.value}
                required={required && index === 0 && !anotherAreaIsFilled}
                maxLength={maxLength}
                onChange={(event) =>
                  updateArea(area.id, event.currentTarget.value)
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove service area ${index + 1}`}
                onClick={() => {
                  const replacement = {
                    id: crypto.randomUUID(),
                    value: "",
                  };
                  setAreas((current) => {
                    const next = current.filter((item) => item.id !== area.id);

                    return next.length ? next : [replacement];
                  });
                }}
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
          onClick={() => {
            const newArea = { id: crypto.randomUUID(), value: "" };
            setAreas((current) => [...current, newArea]);
          }}
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
