# Daily Fret 🎸

A premium, low-friction daily routine tracker specifically designed for the modern guitar learning journey. Built with a "local-first" architecture to ensure maximum performance and accessibility, regardless of network state.

## Core Features
- **Frictionless Daily Path**: Instantly load into your day's tasks. No bloated dashboards.
- **Local-First & Offline Ready**: Powered by Zustand and `localStorage`. Your data is always available instantly.
- **Cloud Sync**: Optional Firebase Authentication enables seamless cross-device syncing of your routines and progress.
- **Aesthetic Excellence**: Built strictly with Vanilla CSS and Framer Motion. Zero UI frameworks. 2026-level micro-interactions.
- **Flexible Routines**: Ships with structured 10-Minute and 30-Minute practice templates out of the box.

## Architecture & Stack
- **Frontend**: React 19, TypeScript, Vite
- **Styling**: Vanilla CSS (Nesting, Variables, Custom properties)
- **State**: Zustand (Persisted)
- **Animations**: Framer Motion
- **Backend Sync**: Firebase Firestore & Auth
- **Hosting**: Cloudflare Pages

## Getting Started

1. Clone the repository:
   ```bash
   git clone https://github.com/acarsondave/daily-fret.git
   ```
2. Install dependencies:
   ```bash
   cd daily-fret
   npm install
   ```
3. Set up environment variables:
   Create a `.env.local` file with your Firebase configuration.
   ```
   VITE_FIREBASE_API_KEY=your_api_key
   VITE_FIREBASE_AUTH_DOMAIN=your_auth_domain
   VITE_FIREBASE_PROJECT_ID=your_project_id
   VITE_FIREBASE_STORAGE_BUCKET=your_storage_bucket
   VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
   VITE_FIREBASE_APP_ID=your_app_id
   ```
4. Run the development server:
   ```bash
   npm run dev
   ```

## Contributing
This project is currently built for personal use but engineered for scalability. PRs are welcome for bug fixes or aesthetic improvements.
