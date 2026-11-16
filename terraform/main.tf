
terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# Dynamic AMI lookup for Ubuntu 22.04 LTS (Jammy)
data "aws_ami" "ubuntu" {
  most_recent = true

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }

  owners = ["099720109477"] # Canonical
}

# User-provided public SSH key for key-pair creation.
# The private key remains on the local host.
resource "aws_key_pair" "civichelp_key" {
  count      = var.public_key != "" ? 1 : 0
  key_name   = var.key_name
  public_key = var.public_key
}

# Security Group:
# HTTP (80) open publicly.
# SSH (22) restricted to administrator CIDR.
# Backend port 5001 is NOT publicly exposed.
resource "aws_security_group" "civichelp_sg" {
  name        = "civichelp-sg"
  description = "CivicHelp Security Group - HTTP and restricted SSH"

  ingress {
    description = "SSH administrative access"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.admin_cidr]
  }

  ingress {
    description = "HTTP web traffic via Nginx"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # Backend traffic reaches Express through Nginx internally.

  egress {
    description = "Allow all outbound traffic"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "civichelp-sg"
  }
}

# EC2 Instance - Single-node CivicHelp deployment
resource "aws_instance" "civichelp_server" {
  ami                         = data.aws_ami.ubuntu.id
  instance_type               = var.instance_type
  availability_zone           = "us-east-1a"
  key_name                    = var.public_key != "" ? aws_key_pair.civichelp_key[0].key_name : var.key_name
  vpc_security_group_ids      = [aws_security_group.civichelp_sg.id]
  associate_public_ip_address = true

  root_block_device {
    volume_size           = 20
    volume_type           = "gp3"
    delete_on_termination = true
  }

  tags = {
    Name = "civichelp-server"
  }
}
