# Reminder Time Design

Date: 2026-10-13

## Goal

Each item can have its own notification time. New items default to one day before the due time. Existing items keep their saved notificationAt value.

## Behavior

- New reminders and memos use notificationAt = dueAt minus one day.
- Blackboard imports keep the same one-day default.
- Editing an item changes only that item's notification time.
- Existing saved notification times are never overwritten by the new default.
- The scheduler uses each item's notificationAt and falls back to dueAt only when it is absent.
- A notification time later than the due time is rejected.
- Local date-time arithmetic handles crossing calendar days.

## UI

The item editor adds a Notification time field with shortcuts:

- 1 hour before
- 3 hours before
- 1 day before (default)
- 2 days before
- Custom

Custom mode accepts a date and time. Blackboard items show their current notification time while editing.

## Boundaries

- Add a pure helper for subtracting a lead time from a local date-time.
- The repository assigns the default for new items.
- The editor owns shortcuts, input, and validation.
- The scheduler and notification transports remain unchanged.
- No global setting is added; per-item choices are preserved.

## Verification

Add failing tests first for the default, shortcuts, custom values, invalid values, existing values, and scheduler timing. Then run unit tests, npm run check, the full test suite, and production build.

