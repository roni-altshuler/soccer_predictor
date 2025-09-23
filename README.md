# Soccer Stats Predictor

This project is a Next.js application designed to provide data-driven insights into soccer match outcomes, with an initial focus on the Premier League.

## Features

*   **AI/ML Algorithm (Planned):** The platform aims to develop an advanced AI/ML algorithm, trained on historical data, to offer users guided decision-making for predicting winner outcomes, considering factors like home versus away advantage.
*   **Responsive Navigation:** A professional and easy-to-use menu navigation bar with dynamic spacing, ensuring optimal display across various screen sizes.
*   **Leagues Section:**
    *   A dedicated "Leagues" dropdown menu in the navigation bar, featuring top European leagues (Premier League, Champions League, LaLiga, FIFA World Cup, Bundesliga, MLS, Serie A, Europa League, Ligue 1).
    *   Each league entry is clearly displayed on a single line with a subtle border for visual separation.
    *   Dedicated landing pages for each league, providing:
        *   A descriptive blurb about the league's history and characteristics.
        *   The official league logo, appropriately scaled and displayed within a contrasting box for visibility.
        *   Hyperlinks to official league websites within the descriptions, styled to glow on hover and open in new tabs.
        *   An "Explore Seasons" dropdown menu (currently functional for Premier League, with placeholders for other leagues).
*   **Premier League Standings:** For the Premier League, users can select a season to view the final league standings, presented in a clear, sortable table format with team positions.
*   **Global Styling & Responsiveness:**
    *   A consistent dark theme with matching header and footer colors and subtle cream/off-white horizontal lines.
    *   A full-field soccer stadium background image, subtly integrated to enhance the aesthetic without distracting from content.
    *   Controlled vertical overflow across the entire website, enabling scrolling only when necessary (e.g., for league standings).
    *   The home landing page features a centered descriptive text about the tool's purpose.

## Getting Started

This project is built with Next.js.

To run the website, follow these steps:

1.  Install the dependencies:

    ```bash
    npm install
    ```

2.  Run the development server:

    ```bash
    npm run dev
    ```

3.  Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Resources & Credits

*   **Framework:** Next.js
*   **Styling:** Tailwind CSS
*   **SVG Icons:** Logos sourced from `svgrepo.com` and `brandlogos.net`.
*   **Data:** Historical soccer data provided in CSV format within the `/data` directory.

## Gemini API Key

This project uses the Gemini API. The API key is stored in the `gemini.md` file. Please do not commit this file to any public repository.