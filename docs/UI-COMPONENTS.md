# Shared UI components

Welio uses the existing shadcn Base UI / Nova components and shared light amber
theme. Product screens compose these components rather than styling native
controls independently.

| Area                                                               | Shared components                                                                             |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Dashboard navigation                                               | Sidebar, SidebarMenu, SidebarTrigger, Sheet, Tooltip                                          |
| Account and workspace menus                                        | DropdownMenu, Input, Avatar, AvatarFallback                                                   |
| Overview activity chart                                            | ChartContainer, ChartTooltip, Recharts AreaChart                                              |
| Sign-in, sign-up, recovery, onboarding, settings and booking forms | Field, FieldGroup, FieldSet, FieldLegend, Input, Textarea, Checkbox, NativeSelect, InputGroup |
| Data lists                                                         | Table through the shared Grid wrapper; Badge through Status                                   |
| Panels                                                             | Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent                         |
| Forms and confirmations in overlays                                | Dialog and its title, description and footer                                                  |
| Page sections                                                      | Tabs with the shared line variant                                                             |
| Errors, notices and empty results                                  | Alert through Notice; Empty through Blank                                                     |
| Customer and owner preview conversations                           | MessageScroller, Message, Bubble                                                              |
| Loading and delivery-status disclosure                             | Spinner, Collapsible                                                                          |

The brand SVG, page layout, booking steps, business content and application logic
remain product code. These are not substitute implementations of shared controls.

Use components from `web/src/components/ui` for new shared controls and
import them from `@/components/ui/...`. The shadcn CLI configuration lives
in `web/components.json`. Theme changes belong in `web/src/app/globals.css`.
Preserve form names, values, validation and explicit booking consent when changing
UI. Do not replace installed components with global native-element styling.
Shared wrappers such as Grid, Panel and Notice should continue composing shadcn
primitives.
