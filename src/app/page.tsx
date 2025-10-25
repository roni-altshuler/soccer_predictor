import Link from 'next/link'

export default function Home() {
  return (
    <div className="max-w-6xl mx-auto text-center py-12">
      <h1 className="text-5xl font-extrabold mb-6">
        Welcome to Soccer Stats Predictor
      </h1>
      
      <div className="mb-12">
        <p className="text-2xl text-gray-300 mb-4">
          Your AI-powered assistant for analyzing soccer match outcomes
        </p>
        <p className="text-lg text-gray-400">
          Using advanced machine learning to predict match results based on historical data
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
        <Link href="/upcoming" className="block group">
          <div className="bg-gray-800 p-8 rounded-xl shadow-lg hover:shadow-green-500/50 transition-all duration-300 transform hover:-translate-y-2 cursor-pointer border-4 border-transparent hover:border-green-500 h-full flex flex-col">
            <h2 className="text-3xl font-bold mb-4 flex items-center justify-center whitespace-nowrap">📅 Upcoming Matches</h2>
            <p className="text-lg text-gray-400">Get predictions for upcoming matches in major leagues</p>
          </div>
        </Link>
        <Link href="/predict?mode=head-to-head" className="block group">
          <div className="bg-gray-800 p-8 rounded-xl shadow-lg hover:shadow-green-500/50 transition-all duration-300 transform hover:-translate-y-2 cursor-pointer border-4 border-transparent hover:border-green-500 h-full flex flex-col">
            <h2 className="text-3xl font-bold mb-4">🏠 Head-to-Head</h2>
            <p className="text-lg text-gray-400">Compare teams within the same league and get detailed match predictions</p>
          </div>
        </Link>
        <Link href="/predict?mode=cross-league" className="block group">
          <div className="bg-gray-800 p-8 rounded-xl shadow-lg hover:shadow-green-500/50 transition-all duration-300 transform hover:-translate-y-2 cursor-pointer border-4 border-transparent hover:border-green-500 h-full flex flex-col">
            <h2 className="text-3xl font-bold mb-4">🌍 Cross-League</h2>
            <p className="text-lg text-gray-400">Analyze hypothetical matchups between teams from different leagues</p>
          </div>
        </Link>
      </div>

      <div className="bg-gray-800 p-6 rounded-lg shadow-inner">
        <h2 className="text-2xl font-semibold mb-4">⚠️ Disclaimer</h2>
        <p className="text-gray-400">
          This tool is for educational and entertainment purposes only.
          Predictions are based on historical data and should not be used for betting.
        </p>
      </div>
    </div>
  )
}