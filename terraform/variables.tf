variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name (demo, dev, prod)"
  type        = string
  default     = "demo"
}

variable "project_name" {
  description = "Project name used in resource naming"
  type        = string
  default     = "workflow-orchestrator"
}

variable "vpc_cidr" {
  description = "CIDR range for VPC"
  type        = string
  default     = "10.40.0.0/16"
}

variable "public_subnet_cidrs" {
  description = "Public subnet CIDR ranges"
  type        = list(string)
  default     = ["10.40.0.0/24", "10.40.1.0/24"]
}

variable "private_subnet_cidrs" {
  description = "Private subnet CIDR ranges for stateful services"
  type        = list(string)
  default     = ["10.40.10.0/24", "10.40.11.0/24"]
}

variable "api_container_cpu" {
  description = "CPU units for API task"
  type        = number
  default     = 256
}

variable "api_container_memory" {
  description = "Memory (MiB) for API task"
  type        = number
  default     = 512
}

variable "worker_container_cpu" {
  description = "CPU units for worker task"
  type        = number
  default     = 256
}

variable "worker_container_memory" {
  description = "Memory (MiB) for worker task"
  type        = number
  default     = 512
}

variable "ui_container_cpu" {
  description = "CPU units for UI task"
  type        = number
  default     = 256
}

variable "ui_container_memory" {
  description = "Memory (MiB) for UI task"
  type        = number
  default     = 512
}

variable "api_desired_count" {
  description = "Desired task count for API service"
  type        = number
  default     = 1
}

variable "worker_desired_count" {
  description = "Desired task count for worker service"
  type        = number
  default     = 1
}

variable "ui_desired_count" {
  description = "Desired task count for UI service"
  type        = number
  default     = 1
}

variable "use_fargate_spot" {
  description = "Use Fargate Spot capacity providers for ECS services"
  type        = bool
  default     = true
}

variable "db_name" {
  description = "RDS database name"
  type        = string
  default     = "orchestrator"
}

variable "db_username" {
  description = "RDS admin username"
  type        = string
  default     = "orchestrator"
}

variable "db_password" {
  description = "RDS admin password"
  type        = string
  sensitive   = true
}

variable "redis_node_type" {
  description = "ElastiCache node type"
  type        = string
  default     = "cache.t4g.micro"
}

variable "api_image_tag" {
  description = "Container image tag for API"
  type        = string
  default     = "latest"
}

variable "worker_image_tag" {
  description = "Container image tag for worker"
  type        = string
  default     = "latest"
}

variable "ui_image_tag" {
  description = "Container image tag for UI"
  type        = string
  default     = "latest"
}

variable "auth_tokens" {
  description = "Auth token mapping for API"
  type        = string
  default     = "admin-token:admin,operator-token:operator,viewer-token:viewer"
}
