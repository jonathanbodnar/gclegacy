# PlanTakeoff Frontend

React-based frontend application for the PlanTakeoff AI-powered plan analysis platform.

## Features

- 📁 **File Upload**: Drag-and-drop interface for PDF, DWG, and BIM files
- 🎯 **Job Management**: Create and monitor analysis jobs
- 📊 **Takeoff Visualization**: Interactive display of extracted features
- 📋 **Materials Lists**: Generated materials with pricing and quantities
- 🖼️ **Plan Overlays**: Visual overlays showing detected features
- 📈 **Progress Tracking**: Real-time job status and progress
- 🔔 **Notifications**: Toast notifications for job updates

## Tech Stack

- **React 18** with TypeScript
- **Vite** for fast development and building
- **TailwindCSS** for styling
- **React Query** for API state management
- **React Router** for navigation
- **Recharts** for data visualization
- **Headless UI** for accessible components

## Getting Started

### Prerequisites

- Node.js 18+
- npm 9+

### Installation

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

The app will be available at `http://localhost:5173`

### Environment Variables

Create a `.env.local` file in the frontend directory:

```env
VITE_API_BASE_URL=http://localhost:3000/v1
VITE_API_TIMEOUT=30000
```

For production, update the API URL to your Railway backend:

```env
VITE_API_BASE_URL=https://your-railway-backend.railway.app/v1
```

## Project Structure

```
frontend/
├── src/
│   ├── components/         # Reusable UI components
│   ├── pages/             # Page components
│   ├── hooks/             # Custom React hooks
│   ├── services/          # API service functions
│   ├── types/             # TypeScript type definitions
│   ├── utils/             # Utility functions
│   └── App.tsx            # Main app component
├── public/                # Static assets
└── package.json
```

## Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint

## API Integration

The frontend communicates with the PlanTakeoff API backend:

- Authentication via JWT tokens
- File upload with progress tracking
- Real-time job status updates
- Takeoff data visualization
- Materials list management

## Deployment

### Development
```bash
npm run dev
```

### Production Build
```bash
npm run build
```

### Deploy to Railway
The frontend can be deployed as a static site or with a Node.js server. See the main README for deployment instructions.

## Contributing

1. Follow the existing code style
2. Use TypeScript for all new code
3. Add proper error handling
4. Test your changes thoroughly

## License

Copyright (c) 2025 PlanTakeoff. All rights reserved.
