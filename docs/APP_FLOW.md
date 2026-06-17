# App Flow

1. **App Load**:
   - Check local storage for auth state and cached routines.
   - If user is not logged in, they see the "Login/Register" overlay *over* the main app (which shows the default routines in the background).
   - If they dismiss or aren't logged in, they can still use the app (saved to local storage).

2. **Main View (The Daily Path)**:
   - Displays the current date prominently.
   - Shows the selected routine (Defaults to "10-Min Muscle" if none picked today).
   - A list of checklist items.
   - Floating Action Button (FAB) or minimal input to "Add ad-hoc task".

3. **Task Completion**:
   - User checks a task. A satisfying animation plays.
   - When all tasks in the routine are checked, the "Jotter" modal automatically slides up.

4. **Feedback Jotter**:
   - Minimal text area. "Thoughts on today's lesson... where are you at now?"
   - Saves to the daily log in Firestore.

5. **Routine Manager**:
   - Accessed via a discrete settings/routine icon.
   - Slides in from the side/bottom.
   - Allows importing routines via JSON or selecting presets.
