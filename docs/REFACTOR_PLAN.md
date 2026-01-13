# Refactor Plan (Not Executing Now)

Goal
- Make the React structure more human-readable and durable without changing behavior.

Target structure (frontend only)
```
src/
  app/            # app shell, routing, providers
  pages/          # route-level components
  features/       # domain features (booking, auth, schedule)
  components/     # shared UI components
  hooks/          # shared hooks
  lib/            # utilities, clients
  styles/         # global styles
  types/          # shared types
```

Proposed migration steps
1) Create new directories without moving files yet.
2) Move one feature at a time (e.g., `PublicBooking`, `Schedule`).
3) Update imports and run lint/build after each move.
4) Update alias paths in `tsconfig.json` and `vite.config.ts` if needed.
5) Update any references in `src/main.tsx` and `src/App.tsx`.

Suggested commands (when approved)
```bash
mkdir -p src/app src/features src/styles src/types
# Example moves (adjust per feature)
# mv src/pages/PublicBooking.tsx src/features/booking/PublicBooking.tsx
# mv src/components/public-booking src/features/booking/components
```

Testing after refactor
- `npm run lint`
- `npm run build`

Notes
- No refactor will be executed until you approve.
