import React from 'react';

interface FeatureImportanceChartProps {
  league: string;
}

const toTitleCase = (str: string) => {
  return str.replace(
    /\w\S*/g,
    (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
  );
};

const FeatureImportanceChart: React.FC<FeatureImportanceChartProps> = ({ league }) => {
  if (!league) {
    return null;
  }

  const imageUrl = `/api/visualizations/${league}/${league}_feature_importance.png`;
  const title = `${toTitleCase(league.replace(/_|-/g, ' '))} - Top Feature Importances`;

  return (
    <div className="bg-gray-800 p-6 rounded-lg shadow-md border border-gray-700 flex flex-col items-center">
      <h2 className="text-2xl font-bold mb-4 text-center">{title}</h2>
      <div className="relative w-full max-w-3xl h-96">
        <img src={imageUrl} alt={title} className="w-full h-full object-contain rounded-md border border-gray-600" />
      </div>
    </div>
  );
};

export default FeatureImportanceChart;
