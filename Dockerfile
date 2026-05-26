FROM node:22

WORKDIR /app

RUN npm install -g openclaw@latest

CMD ["bash"]