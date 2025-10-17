import { useState } from 'react'
import './App.css'

function App() {
  const [count, setCount] = useState(0)

  return (
    <div className="App">
      <div className="container mx-auto px-4 py-8">
        <header className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            PlanTakeoff Platform
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            AI-powered architectural/MEP plan analysis and takeoff platform. 
            Upload plan files, extract geometry and dimensions, generate normalized takeoff data.
          </p>
        </header>

        <main className="text-center">
          <div className="bg-white rounded-lg shadow-md p-6 max-w-md mx-auto">
            <h2 className="text-2xl font-semibold mb-4">Frontend Coming Soon</h2>
            <p className="text-gray-600 mb-4">
              The React frontend is being built. For now, you can access the API directly:
            </p>
            <div className="space-y-2">
              <a 
                href="/api/docs" 
                className="inline-block bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded transition-colors"
                target="_blank"
                rel="noopener noreferrer"
              >
                API Documentation
              </a>
            </div>
            
            <div className="mt-6 p-4 bg-gray-50 rounded">
              <p className="text-sm text-gray-500">
                Counter demo: <span className="font-mono">{count}</span>
              </p>
              <button
                onClick={() => setCount(count + 1)}
                className="mt-2 bg-green-500 hover:bg-green-600 text-white px-3 py-1 rounded text-sm transition-colors"
              >
                Increment
              </button>
            </div>
          </div>
        </main>

        <footer className="text-center mt-12 text-gray-500">
          <p>PlanTakeoff Platform - Backend API is ready, Frontend in development</p>
        </footer>
      </div>
    </div>
  )
}

export default App
