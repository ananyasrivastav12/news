News Summarizer API
This is the backend service for the News Summarizer application. It provides a RESTful API for user management, interest tracking, and delivering summarized content. The application is built with FastAPI and runs in Docker containers.

Prerequisites
Before you begin, ensure you have the following installed on your system:
Docker
Docker Compose (typically included with Docker Desktop)
Setup Instructions
Follow these steps to get the application running locally.

1. Clone the Repository
git clone <your-repository-url>
cd <your-repository-name>/backend

2. Create the Environment File
The application requires an environment file (.env) for configuration. A template is provided in .env.example.
Copy the example file:
cp .env.example .env

Generate a Secret Key: The SECRET_KEY is used to sign security tokens. Generate a secure key by running the following command in your terminal and copy the output.
openssl rand -hex 32

Update the .env file: Open the newly created .env file and paste the key you just generated as the value for SECRET_KEY.
Your final .env file should look like this:
DATABASE_URL="postgresql://newsuser:newspass@db:5432/newsdb"
SECRET_KEY="your_super_secret_key_pasted_here"

Running the Application
Build and Start the Services:
From the backend directory, run the following command. This will build the FastAPI application's Docker image and start both the web server and database containers. The -d flag runs them in the background (detached mode).
docker-compose up --build -d

Verify the Services are Running:
To check that the containers have started successfully, run:
docker-compose ps

You should see both backend-db-1 and backend-web-1 with a STATUS of running or Up.
Running Database Migrations
The first time you start the application, you need to apply the database migrations to create the necessary tables.

docker-compose exec web alembic upgrade head

You only need to run this command once initially. If you make changes to the database models in app/db/model.py in the future, you will need to generate a new migration and apply it.

Accessing the API
API Documentation (Swagger UI): http://localhost:8000/docs
Health Check Endpoint: http://localhost:8000/health
The interactive API documentation at /docs allows you to test all available endpoints directly from your browser.

Stopping the Application
To stop the running Docker containers, use the following command:

docker-compose down
