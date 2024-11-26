# URL Shortener

A full-stack URL shortener application built with React and Node.js.

## Features

- Shorten long URLs to unique, manageable links
- Custom slug support
- QR code generation for shortened URLs
- Access statistics tracking
- Browser and referrer analytics
- Time-to-Live (TTL) support for URLs
- Persistent storage

## Tech Stack

### Frontend
- React
- TailwindCSS
- Local Storage for persistence

### Backend
- Node.js
- Express
- File-based storage
- QR Code generation
- Rate limiting

## Setup

1. Clone the repository:
```bash
git clone [your-repo-url]
cd url-shortener
```

2. Install dependencies:
```bash
# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install
```

3. Start the servers:

Backend:
```bash
cd backend
npm run dev
```

Frontend:
```bash
cd frontend
npm start
```

The application will be available at:
- Frontend: http://localhost:3000
- Backend: http://localhost:3001

## API Endpoints

- `POST /api/shorten` - Create short URL
- `GET /:shortId` - Redirect to original URL
- `GET /api/stats/:shortId` - Get URL statistics
- `GET /api/health` - Service health check

## Environment Variables

Create a `.env` file in the backend directory:
```env
PORT=3001
```

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request