# Design System

## Theme: Dark Studio

### Colors
- **Background**: `#0F0F11` (Deep Charcoal/Almost Black)
- **Surface**: `#18181B` (Slightly lighter, used for cards/glass panels)
- **Primary Accent**: `#E2E8F0` (Off-white for primary text)
- **Secondary Accent**: `#A1A1AA` (Muted gray for secondary text/icons)
- **Highlight/Active**: `#38BDF8` (Electric Blue) or `#FBBF24` (Amber for achievements)
- **Success/Check**: `#34D399` (Soft Green)

### Typography
- **Font Family**: 'Outfit' (Primary headers/bold statements), 'Inter' (fallback for body, though user wanted to avoid Inter. We will use 'Plus Jakarta Sans' or 'Outfit' for everything to keep it fresh).
- **Scale**:
  - H1: 2.5rem (Bold, tight tracking)
  - H2: 1.5rem (Semibold)
  - Body: 1rem (Regular, 1.5 line height)
  - Small: 0.875rem (Medium)

### Spacing
- Base unit: `4px`
- Scale: 4, 8, 12, 16, 24, 32, 48, 64.

### Animations
- **Micro-interactions**: Fast, bouncy (spring physics). e.g., framer-motion `type: 'spring', stiffness: 400, damping: 25`.
- **Page/Modal Load**: Smooth fade up. `duration: 0.4s, ease: [0.16, 1, 0.3, 1]`.
