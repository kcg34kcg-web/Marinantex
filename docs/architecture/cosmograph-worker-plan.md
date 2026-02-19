# Cosmograph + Worker Plan

## Rendering
- Graph canvas: Cosmograph (PixiJS)
- Node target: 100k+
- Interaction: clustering, temporal slider, contradiction overlays

## Worker Strategy
- Worker computes force layout ticks.
- Main thread only handles rendering and pointer events.
- Delta updates streamed from worker via transferable objects.

## Data Strategy
- Use TanStack Virtual for side panels, node tables, evidence lists.
- Lazy fetch node neighborhoods to avoid full graph hydration.

## Performance Budget
- Main thread frame budget: < 16ms
- Worker cycle budget: adaptive, 8–20ms
- Memory guardrails: chunked edge arrays + recycling pools
