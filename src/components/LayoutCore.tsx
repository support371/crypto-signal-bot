import { useState } from 'react';
import { Link, Outlet } from 'react-router-dom';
import Header from './Header';
import Sidebar from './Sidebar';

export default function LayoutCore() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-gray-50">
      <Header onMenuClick={() => setSidebarOpen((open) => !open)} />
      <div className="flex">
        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <main className={`flex-1 transition-all duration-300 ${sidebarOpen ? 'ml-0 md:ml-64' : 'ml-0'}`}>
          <div className="border-b border-secondary-200 bg-white px-4 py-2 md:px-6 lg:px-8">
            <div className="flex justify-end">
              <Link
                to="/infrastructure"
                className="rounded-lg border border-primary-200 bg-primary-50 px-3 py-1.5 text-sm font-semibold text-primary-700 transition hover:bg-primary-100"
              >
                Infrastructure
              </Link>
            </div>
          </div>
          <div className="p-4 md:p-6 lg:p-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
