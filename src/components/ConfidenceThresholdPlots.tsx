'use client'

import { Fragment } from 'react';

interface ConfidenceThresholdPlotsProps {
  league: string;
  set_name: 'train' | 'test';
  classes: string[];
}

export function ConfidenceThresholdPlots({
  league,
  set_name,
  classes,
}: ConfidenceThresholdPlotsProps) {
  const baseImageUrl = `/api/analytics/image?league=${league}&image_name=`;

  return (
    <div className="bg-secondary p-6 rounded-lg space-y-8">
      <h2 className="text-2xl font-semibold mb-4">
        {set_name.charAt(0).toUpperCase() + set_name.slice(1)} Set Performance by Confidence Threshold
      </h2>

      {classes.map((cls) => (
        <Fragment key={cls}>
          <h3 className="text-xl font-medium mt-6 mb-2">{cls.charAt(0).toUpperCase() + cls.slice(1)} Class Metrics</h3>
          <img
            src={`${baseImageUrl}${league}_${set_name}_${cls}_confidence_metrics.png`}
            alt={`${league} ${set_name} ${cls} confidence metrics`}
            className="w-full h-auto"
          />
          <p className="text-sm text-gray-400 mt-2">
            This graph shows the Precision, Recall, and F1-Score for the "{cls}" class at different confidence thresholds. Precision indicates the accuracy of positive predictions, Recall measures the ability to find all positive samples, and F1-Score is the harmonic mean of precision and recall. A higher score generally means better performance. Observe how these metrics change as the model becomes more confident in its predictions.
          </p>
        </Fragment>
      ))}

      <h3 className="text-xl font-medium mt-6 mb-2">Overall Accuracy</h3>
      <img
        src={`${baseImageUrl}${league}_${set_name}_overall_accuracy_confidence.png`}
        alt={`${league} ${set_name} overall accuracy confidence`}
        className="w-full h-auto"
      />
      <p className="text-sm text-gray-400 mt-2">
        This graph displays the overall accuracy of the model's predictions at various confidence thresholds. It shows how many of the predictions made (where the model was confident enough) were correct. As the confidence threshold increases, the number of predictions made might decrease, but their accuracy should ideally increase.
      </p>
    </div>
  );
}
