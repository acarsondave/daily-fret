import { IconBase, type IconProps } from './Icon';

// The marks for filming a practice session. Same 24 grid, same 1.75 pen as the
// rest of the set, so the camera in settings sits at the same optical weight as
// the microphone directly above it.

// A camcorder, not a stills camera. What this feature does is run for twenty
// minutes in the corner of the room, and a shutter button says the opposite of
// that. The prism on the right is what makes it read as video at 18px.
export const CameraIcon = (p: IconProps) => (
  <IconBase {...p}>
    <rect x="2.6" y="6.6" width="12.8" height="10.8" rx="2.6" />
    <path d="M15.4 10.8 20.2 8a.8.8 0 0 1 1.2.7v6.6a.8.8 0 0 1-1.2.7l-4.8-2.8Z" />
    <circle cx="8" cy="12" r="2.3" />
  </IconBase>
);

// The camera is rolling. A filled centre inside an open ring: the only mark in
// the app that is solid at its core, so it cannot be mistaken for any of the
// outlined states around it.
export const RecordIcon = (p: IconProps) => (
  <IconBase {...p}>
    <circle cx="12" cy="12" r="8.4" />
    <circle cx="12" cy="12" r="3.7" fill="currentColor" stroke="none" />
  </IconBase>
);

// Where to put the camera. Four corner brackets with the neck of a guitar
// raked through them, which is the whole instruction a framing guide gives:
// this much of the picture, with the neck across it.
export const FramingIcon = (p: IconProps) => (
  <IconBase {...p}>
    <path d="M4 9.2V6.6A2.6 2.6 0 0 1 6.6 4h2.6" />
    <path d="M14.8 4h2.6A2.6 2.6 0 0 1 20 6.6v2.6" />
    <path d="M20 14.8v2.6a2.6 2.6 0 0 1-2.6 2.6h-2.6" />
    <path d="M9.2 20H6.6A2.6 2.6 0 0 1 4 17.4v-2.6" />
    <path d="M7.8 16.2 16.2 7.8" />
  </IconBase>
);

// What the footage is costing. A stack of platters rather than a hard drive
// outline, because the number beside it is a volume and not a device.
export const StorageIcon = (p: IconProps) => (
  <IconBase {...p}>
    <ellipse cx="12" cy="6.4" rx="7.4" ry="2.8" />
    <path d="M4.6 6.4v5.2c0 1.55 3.3 2.8 7.4 2.8s7.4-1.25 7.4-2.8V6.4" />
    <path d="M4.6 11.6v5.2c0 1.55 3.3 2.8 7.4 2.8s7.4-1.25 7.4-2.8v-5.2" />
  </IconBase>
);

// Kept, whatever the retention count says. Drawn at the same weight as the rest
// rather than borrowed, so a starred clip reads as this app's own decision.
export const KeepIcon = (p: IconProps) => (
  <IconBase {...p}>
    <path d="M12 3.9 14.5 9l5.6.8-4 4 .9 5.6-5-2.7-5 2.7.9-5.6-4-4 5.6-.8Z" />
  </IconBase>
);
