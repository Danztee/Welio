# Application UI

The browser-only demo has been retired. All dashboard sections use dedicated `/dashboard` routes and real workspace records.

- Light theme with yellow primary actions and outlined secondary actions.
- Compact workspace and account menus; workspace creation links to `/onboarding`.
- No persistent role badge, breadcrumb, dashboard footer, or repeated workspace subtitle.
- Shared centered dialogs with consistent spacing, close controls, and action footers.
- Underlined page tabs, bordered tables, appointment status filtering, and customer search.
- Real account, booking, availability, and email workflows remain in place.

Run `pnpm check` and `pnpm build` for static verification. Manually review signed-in desktop and mobile flows using a development account. Live email and AI delivery require configured providers.
