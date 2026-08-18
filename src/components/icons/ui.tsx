import { IconBase, type IconProps } from './Icon';

// Interface plumbing, drawn on the same grid as the practice marks so a Trash
// beside a Plectrum never looks borrowed from somewhere else.

export const CheckIcon = (p: IconProps) => (
  <IconBase {...p}>
    <path d="M5.5 12.5 10 17l8.5-9.5" />
  </IconBase>
);

export const CircleIcon = (p: IconProps) => (
  <IconBase {...p}>
    <circle cx="12" cy="12" r="8.5" />
  </IconBase>
);

export const CheckCircleIcon = (p: IconProps) => (
  <IconBase {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M8.2 12.3 11 15.1l5-5.6" />
  </IconBase>
);

export const PlusIcon = (p: IconProps) => (
  <IconBase {...p}>
    <path d="M12 5.5v13M5.5 12h13" />
  </IconBase>
);

export const MinusIcon = (p: IconProps) => (
  <IconBase {...p}>
    <path d="M5.5 12h13" />
  </IconBase>
);

export const CloseIcon = (p: IconProps) => (
  <IconBase {...p}>
    <path d="M6.8 6.8 17.2 17.2M17.2 6.8 6.8 17.2" />
  </IconBase>
);

export const CaretDownIcon = (p: IconProps) => (
  <IconBase {...p}>
    <path d="M6.5 9.5 12 15l5.5-5.5" />
  </IconBase>
);

export const ArrowRightIcon = (p: IconProps) => (
  <IconBase {...p}>
    <path d="M4.5 12h14M13.5 7l5 5-5 5" />
  </IconBase>
);

export const ArrowLeftIcon = (p: IconProps) => (
  <IconBase {...p}>
    <path d="M19.5 12h-14M10.5 7l-5 5 5 5" />
  </IconBase>
);

export const ArrowUpIcon = (p: IconProps) => (
  <IconBase {...p}>
    <path d="M12 19.5v-14M7 10.5l5-5 5 5" />
  </IconBase>
);

export const ArrowDownIcon = (p: IconProps) => (
  <IconBase {...p}>
    <path d="M12 4.5v14M7 13.5l5 5 5-5" />
  </IconBase>
);

// Two chords traded back and forth. The shafts sit apart so the pair reads as a
// cycle at 14px, which is the size the changes drill actually uses it at.
export const SwapIcon = (p: IconProps) => (
  <IconBase {...p}>
    <path d="M4.5 8.8h13.8M15.2 5.6l3.2 3.2-3.2 3.2" />
    <path d="M19.5 15.2H5.7M8.8 12l-3.2 3.2 3.2 3.2" />
  </IconBase>
);

// A ring that does not quite close, with the head at the top: the rotation
// drill's "come back round to the start".
export const CycleIcon = (p: IconProps) => (
  <IconBase {...p}>
    <path d="M19.4 12a7.4 7.4 0 1 1-2.5-5.6" />
    <path d="M18.6 3.2v3.9h-3.9" />
  </IconBase>
);

// Two heads on one shaft: the anchor drill travels this way and then back the
// same way, and that is the whole shape of the exercise. Drawn rather than said,
// so the sweep needs no caption under it.
//
// The heads are separate paths so a caller can dim the one it is not currently
// travelling towards, which turns a static symbol into a live reading of which
// way the hand is going.
export const SweepIcon = (p: IconProps) => (
  <IconBase {...p}>
    <path d="M5.5 12h13" />
    <path className="sweep-head-back" d="M9 8l-4 4 4 4" />
    <path className="sweep-head-fwd" d="M15 8l4 4-4 4" />
  </IconBase>
);

export const TrashIcon = (p: IconProps) => (
  <IconBase {...p}>
    <path d="M4.8 7h14.4" />
    <path d="M9.6 7V5.3A1.3 1.3 0 0 1 10.9 4h2.2a1.3 1.3 0 0 1 1.3 1.3V7" />
    <path d="M6.9 7.4 7.7 19a1.4 1.4 0 0 0 1.4 1.3h5.8a1.4 1.4 0 0 0 1.4-1.3l.8-11.6" />
    <path d="M10.6 10.8v5.9M13.4 10.8v5.9" />
  </IconBase>
);

export const PencilIcon = (p: IconProps) => (
  <IconBase {...p}>
    <path d="M4.6 19.4h3.2l9.5-9.5a1.7 1.7 0 0 0 0-2.4l-.8-.8a1.7 1.7 0 0 0-2.4 0L4.6 16.2Z" />
    <path d="M13.4 6.8 17.2 10.6" />
  </IconBase>
);

// Faders, not a cog. The app is a music tool and this opens the routine's
// arrangement; a mixing desk says that in a way a gear never has.
export const SlidersIcon = (p: IconProps) => (
  <IconBase {...p}>
    <path d="M4 7h9M17.5 7H20" />
    <path d="M4 12h3.5M12 12h8" />
    <path d="M4 17h8.5M17 17h3" />
    <circle cx="15.2" cy="7" r="1.9" />
    <circle cx="9.7" cy="12" r="1.9" />
    <circle cx="14.7" cy="17" r="1.9" />
  </IconBase>
);

export const UploadIcon = (p: IconProps) => (
  <IconBase {...p}>
    <path d="M12 15.5V4.8M8.2 8.6 12 4.8l3.8 3.8" />
    <path d="M4.8 14.5v3.4a1.6 1.6 0 0 0 1.6 1.6h11.2a1.6 1.6 0 0 0 1.6-1.6v-3.4" />
  </IconBase>
);

export const DownloadIcon = (p: IconProps) => (
  <IconBase {...p}>
    <path d="M12 4.8v10.7M8.2 11.7 12 15.5l3.8-3.8" />
    <path d="M4.8 14.5v3.4a1.6 1.6 0 0 0 1.6 1.6h11.2a1.6 1.6 0 0 0 1.6-1.6v-3.4" />
  </IconBase>
);

export const SignOutIcon = (p: IconProps) => (
  <IconBase {...p}>
    <path d="M14.5 7.2V5.6A1.6 1.6 0 0 0 12.9 4H6.1a1.6 1.6 0 0 0-1.6 1.6v12.8A1.6 1.6 0 0 0 6.1 20h6.8a1.6 1.6 0 0 0 1.6-1.6v-1.6" />
    <path d="M9.8 12h9.7M16.4 8.9l3.1 3.1-3.1 3.1" />
  </IconBase>
);

export const CodeIcon = (p: IconProps) => (
  <IconBase {...p}>
    <path d="M9.2 6.6 4.4 12l4.8 5.4M14.8 6.6 19.6 12l-4.8 5.4" />
  </IconBase>
);

export const TrendUpIcon = (p: IconProps) => (
  <IconBase {...p}>
    <path d="M4 16.2 9.6 10.6l3.3 3.3L20 6.8" />
    <path d="M15.2 6.8H20v4.8" />
  </IconBase>
);

export const TrendDownIcon = (p: IconProps) => (
  <IconBase {...p}>
    <path d="M4 7.8l5.6 5.6 3.3-3.3L20 17.2" />
    <path d="M15.2 17.2H20v-4.8" />
  </IconBase>
);

// "Saved on this device": the practice never left the phone in your hand.
export const DeviceIcon = (p: IconProps) => (
  <IconBase {...p}>
    <rect x="7.4" y="2.8" width="9.2" height="18.4" rx="2.4" />
    <path d="M10.7 5.6h2.6" />
    <circle cx="12" cy="18" r="0.9" fill="currentColor" stroke="none" />
  </IconBase>
);

// "Not saved": the same device, with the write stopped at its wall. Drawn from
// DeviceIcon's own body so the two read as one state changing rather than two
// unrelated marks. The right wall is broken exactly where the write arrives,
// and the bar is what it hit. No slash, no triangle: this says where the result
// went, which is nowhere.
export const DeviceFullIcon = (p: IconProps) => (
  <IconBase {...p}>
    <path d="M14.2 2.8H9.8a2.4 2.4 0 0 0-2.4 2.4v13.6a2.4 2.4 0 0 0 2.4 2.4h4.4a2.4 2.4 0 0 0 2.4-2.4v-4.7" />
    <path d="M16.6 9.9V5.2a2.4 2.4 0 0 0-2.4-2.4" />
    <path d="M10.7 5.6h2.6" />
    <path d="M21.6 12h-3.4" />
  </IconBase>
);

export const CloudIcon = (p: IconProps) => (
  <IconBase {...p}>
    <path d="M7.7 18.4a4.1 4.1 0 0 1-.4-8.2 5.5 5.5 0 0 1 10.5 1.2 3.5 3.5 0 0 1-.5 7Z" />
  </IconBase>
);
