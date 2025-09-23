import Image from "next/image";

export default function Home() {
  return (
    <main className="flex flex-col items-center bg-gray-900 text-white">
      <div className="flex flex-col items-center justify-center flex-grow p-8">
        <div className="text-center max-w-2xl bg-gray-800 rounded-xl shadow-lg">
          <h1 className="text-4xl font-bold mb-4">Welcome to Soccer Stats Predictor</h1>
          <p className="text-lg leading-relaxed">
            This platform provides data-driven insights into soccer match outcomes.<br /><br />
            We aim to develop an advanced AI/ML algorithm, trained on historical data, to offer users guided decision-making when analyzing potential winner outcomes of two teams facing each other.<br /><br />
            Our model considers factors like home versus away advantage, striving for transparency and reliability in its predictions.
          </p>
        </div>
      </div>
    </main>
  );
}