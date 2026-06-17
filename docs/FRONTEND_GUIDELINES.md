# Frontend Guidelines

1. **Vanilla CSS**: Strict adherence to Vanilla CSS. Avoid Tailwind CSS. Use CSS Modules or standard CSS with BEM-like naming conventions if necessary, but keep it semantic.
2. **Local First**: State should be driven by Zustand and persisted to `localStorage` immediately. Firebase syncs in the background to ensure no loading spinners block the user.
3. **No Page Navigations**: Use overlays, modals, and draw-in panels for contexts like "Routine Manager" or "Feedback Jotter" to preserve context.
4. **Micro-animations**: Every interactive element must provide feedback. Checkboxes bounce, buttons scale down on active, and text fades in.
5. **A11y**: Ensure focus states are distinct but elegant.

## Browser Support
Assume a modern execution environment where Baseline Newly Available features can be used natively (e.g., CSS Nesting, `:has()`, Container Queries).
