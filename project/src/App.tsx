import React from 'react';

function App() {
  // Redirect to the static HTML files
  React.useEffect(() => {
    // Redirect to the config page to start the workflow
    window.location.href = '/config.html';
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
      <div className="bg-white/90 backdrop-blur-lg rounded-2xl p-8 shadow-2xl max-w-md w-full mx-4">
        <div className="text-center">
          <div className="mb-4">
            <i className="fas fa-database text-4xl text-blue-600 mb-3"></i>
          </div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">Teable GIS System</h2>
          <p className="text-gray-600 mb-6">Redirecting to configuration...</p>
          
          <div className="space-y-3">
            <a 
              href="/config.html" 
              className="block w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
            >
              <i className="fas fa-cog mr-2"></i>
              Super Admin Config
            </a>
            
            <a 
              href="/login.html" 
              className="block w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
            >
              <i className="fas fa-sign-in-alt mr-2"></i>
              User Login
            </a>
            
            <a 
              href="/dashboard.html" 
              className="block w-full bg-purple-600 hover:bg-purple-700 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
            >
              <i className="fas fa-tachometer-alt mr-2"></i>
              Dashboard
            </a>
          </div>
          
          <div className="mt-6 text-sm text-gray-500">
            <p>Complete Teable.io GIS System</p>
            <p>Mixed Authentication • Field Permissions • Map Views</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;