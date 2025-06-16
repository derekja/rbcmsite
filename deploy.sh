#!/bin/bash

# Build the React app
echo "Building React app..."
npm run build

# Check if build was successful
if [ $? -ne 0 ]; then
  echo "Build failed. Aborting deployment."
  exit 1
fi

# Deploy to AWS EC2 (replace with your actual server details)
echo "Deploying to AWS EC2..."
EC2_HOST="ec2-user@ec2-3-81-55-10.compute-1.amazonaws.com"
SSH_KEY="~/.ssh/rbcmsite.pem"

# Create .htpasswd file for Nginx basic auth
echo "Creating .htpasswd file..."
echo "museum:$(openssl passwd -apr1 objects)" > .htpasswd

# Copy build files to EC2
echo "Copying files to server..."
scp -i $SSH_KEY -r build/* $EC2_HOST:/var/www/rbcmsite/build/
scp -i $SSH_KEY nginx.conf $EC2_HOST:/etc/nginx/sites-available/rbcmsite
scp -i $SSH_KEY .htpasswd $EC2_HOST:/etc/nginx/.htpasswd

# SSH into EC2 and restart Nginx
echo "Configuring server..."
ssh -i $SSH_KEY $EC2_HOST << 'EOF'
  # Create symbolic link if it doesn't exist
  if [ ! -L /etc/nginx/sites-enabled/rbcmsite ]; then
    sudo ln -s /etc/nginx/sites-available/rbcmsite /etc/nginx/sites-enabled/
  fi
  
  # Restart Nginx
  sudo systemctl restart nginx
  
  # Check Nginx status
  sudo systemctl status nginx
EOF

echo "Deployment complete!"