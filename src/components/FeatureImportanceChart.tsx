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
    <div className="bg-[var(--card-bg)] p-8 rounded-lg shadow-lg border border-[var(--border-color)]">
      <div className="text-center mb-4">
        <h2 className="text-3xl font-bold">{title}</h2>
        <div className="w-48 h-1 bg-[var(--accent-primary)] mx-auto mt-2"></div>
      </div>
      <div className="flex flex-col lg:flex-row items-center justify-center gap-8">
        <div className="w-full lg:w-1/2">
          <img src={imageUrl} alt={title} className="w-full h-auto object-contain rounded-md border border-[var(--border-color)]" />
        </div>
        <div className="w-full lg:w-1/2">
          <h3 className="text-2xl font-semibold mb-3">Understanding Feature Importance</h3>
          <p className="text-lg text-[var(--text-secondary)]">
            Feature importance helps us understand which factors have the most significant impact on the model's predictions. In the context of soccer matches, these features can include team form, historical performance, player statistics, and more.
          </p>
          <p className="text-lg text-[var(--text-secondary)] mt-4">
            The chart on the left displays the top features ranked by their importance. A higher score indicates that the feature has a greater influence on the predicted outcome of a match. By analyzing these features, we can gain insights into the key drivers of success in a particular league.
          </p>
        </div>
      </div>
    </div>
  );
};

export default FeatureImportanceChart;
