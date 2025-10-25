# To do list of improvements and new features for Soccer Predictor:

Home page:

- I don't like that the title card for the Upcoming Matches is not center aligned like it is for all the other project card titles. Please fix this

Upcoming Matches:

- There should be a brief description of what this page is for.
- There should be a similar dropdown menu like there is on the analytics page so that users can select which league they want to view upcoming matches for.
- Once the user selects a given league, the page should dynamically update to show the upcoming matches for that league only in a week view format (like a calendar) rather than a long list. However, there should also be an option for the user to select a given day from the week view to see all the matches for that day in a list format. Once the user sees all the matches for that day, the same model that is ran on the head-to-head prediction and cross-league prediction should be ran on these matches, and the same output format should be used (with percentages and bar graph) of the expected outcomes for each match. However, it is important to mention that the model should be ran on the upcoming matches without user input like required on the head-to-head and cross-league pages.
- The upcoming matches data can be found in fbref_data/processed/ folder where in the per league csv files, there is a column (7 respectively) called 'status' which indicates if the match has already been played or is scheduled.
- The week view calendar format should take into considerations day of the week that the user is accessing the page so that the week view is always current to the present day. So for example, if I access the page on Saturday 10/25/25, I should see in the week view format Saturday to Friday of that week with the Friday being 10/31/25.

Models:

- There is a bias towards predicting draws in the matches. This needs to be updated accordingly and fixed because this is not representative of real-world outcomes and with what I am seeing in the ML metrics data for both train and test sets.
- I think it would also be a cool feature, if the model can also report the predicted scoreline.
- If this requires training and making an entirely new model with a different model architecture than what is currently being used and means making an entirely new model.pkl for all the leagues, update the train_league_models.py script accordingly and the analyze_model.py script accordingly, so that the analytics page is also updated with the most recent model performance data
