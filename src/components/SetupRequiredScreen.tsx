/**
 * Setup Required Screen
 * 
 * Displayed when initial setup is required before using the application.
 */

import { Link } from 'react-router-dom';

export default function SetupRequiredScreen() {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center 
                 bg-gradient-to-br from-primary-50 to-secondary-50 p-4"
    >
      <div className="text-center max-w-md">
        <div className="w-20 h-20 bg-primary-100 rounded-full flex items-center 
                    justify-center mx-auto mb-6">
          <svg
            className="w-10 h-10 text-primary-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
            />
          </svg>
        </div>
        
        <h1 className="text-3xl font-bold text-secondary-900 mb-4">
          Welcome to Crypto Signal Bot V2
        </h1>
        
        <p className="text-secondary-600 mb-8">
          Paper trading mode is enabled. All trading operations use mock data 
          and no real funds are at risk.
        </p>
        
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            to="/signin"
            className="px-6 py-3 bg-primary-600 hover:bg-primary-700 
                       text-white font-medium rounded-lg transition-colors"
          >
            Sign In
          </Link>
          <Link
            to="/signup"
            className="px-6 py-3 bg-secondary-200 hover:bg-secondary-300 
                       text-secondary-700 font-medium rounded-lg transition-colors"
          >
            Sign Up
          </Link>
        </div>
        
        <p className="text-xs text-secondary-500 mt-6">
          By using this application, you agree to the terms of service and 
          acknowledge that all trading is simulated.
        </p>
      </div>
    </div>
  );
}