/**
 * Header Component
 * 
 * Top navigation header with branding, menu toggle, and user actions.
 */

import { useAuth } from '../providers/AuthProvider';
import { useUser } from '../providers/UserProvider';
import { Link } from 'react-router-dom';
import { cn } from '../lib/utils';

interface HeaderProps {
  onMenuClick: () => void;
}

export default function Header({ onMenuClick }: HeaderProps) {
  const { user, signOut } = useAuth();
  const { preferences } = useUser();

  return (
    <header
      className="bg-white shadow-sm border-b border-secondary-200 sticky top-0 z-50"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Mobile menu button */}
          <div className="flex items-center md:hidden">
            <button
              onClick={onMenuClick}
              className="p-2 rounded-lg hover:bg-secondary-100 transition-colors"
              aria-label="Toggle menu"
            >
              <svg
                className="w-6 h-6 text-secondary-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 6h16M4 12h16M4 18h16"
                />
              </svg>
            </button>
          </div>

          {/* Logo and branding */}
          <div className="flex items-center space-x-4">
            <Link to="/" className="flex items-center space-x-2">
              <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">CS</span>
              </div>
              <div className="hidden sm:block">
                <span className="text-xl font-bold text-secondary-900">
                  Crypto Signal Bot
                </span>
                <span className="text-xs text-primary-600 ml-2 bg-primary-100 px-2 py-0.5 rounded-full">
                  V2
                </span>
              </div>
            </Link>
          </div>

          {/* Navigation */}
          <nav className="hidden md:flex items-center space-x-1">
            <Link
              to="/"
              className={cn(
                'px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                'hover:bg-secondary-100 text-secondary-600'
              )}
            >
              Dashboard
            </Link>
            <Link
              to="/signals"
              className={cn(
                'px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                'hover:bg-secondary-100 text-secondary-600'
              )}
            >
              Signals
            </Link>
            <Link
              to="/portfolio"
              className={cn(
                'px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                'hover:bg-secondary-100 text-secondary-600'
              )}
            >
              Portfolio
            </Link>
            <Link
              to="/trading"
              className={cn(
                'px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                'hover:bg-secondary-100 text-secondary-600'
              )}
            >
              Trading
            </Link>
          </nav>

          {/* User actions */}
          <div className="flex items-center space-x-4">
            {user ? (
              <>
                <div className="hidden md:flex items-center space-x-4">
                  <span className="text-sm text-secondary-500">
                    Paper Trading Mode
                  </span>
                  <button
                    onClick={signOut}
                    className="px-3 py-1.5 bg-secondary-200 hover:bg-secondary-300 
                               text-secondary-700 text-sm font-medium rounded-lg 
                               transition-colors"
                  >
                    Sign Out
                  </button>
                </div>
                <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center 
                            justify-center text-primary-600 font-medium">
                  {user.username.charAt(0).toUpperCase()}
                </div>
              </>
            ) : (
              <>
                <Link
                  to="/signin"
                  className="hidden md:block px-4 py-2 bg-primary-600 hover:bg-primary-700 
                             text-white text-sm font-medium rounded-lg transition-colors"
                >
                  Sign In
                </Link>
                <Link
                  to="/signup"
                  className="hidden md:block px-4 py-2 bg-secondary-200 hover:bg-secondary-300 
                             text-secondary-700 text-sm font-medium rounded-lg transition-colors"
                >
                  Sign Up
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}