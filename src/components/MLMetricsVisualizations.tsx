import React from 'react';

interface MLMetricsVisualizationsProps {
  league: string;
}

const imageNames = [
  '_train_win_confidence_metrics.png',
  '_train_draw_confidence_metrics.png',
  '_train_loss_confidence_metrics.png',
  '_test_win_confidence_metrics.png',
  '_test_draw_confidence_metrics.png',
  '_test_loss_confidence_metrics.png',
];

const MLMetricsVisualizations: React.FC<MLMetricsVisualizationsProps> = ({ league }) => {
  if (!league) {
    return null;
  }

  return (
    <div className="space-y-8">
      <h2 className="text-3xl font-bold mb-6 text-center">Machine Learning Model Visualizations</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {imageNames.map((imageName) => {
          const fullImageName = `${league}${imageName}`;
          const imageUrl = `/api/visualizations/${league}/${fullImageName}`;
          const title = imageName.replace(/_|-/g, ' ').replace('.png', '').trim();

          return (
            <div key={fullImageName} className="bg-gray-700 p-6 rounded-lg shadow-md border border-gray-600 flex flex-col items-center min-h-[350px]">
              <h3 className="text-lg font-semibold mb-3 text-center capitalize">{title}</h3>
              <img src={imageUrl} alt={title} className="max-w-full h-full object-contain rounded-md" />
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default MLMetricsVisualizations;
