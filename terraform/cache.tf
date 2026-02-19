resource "aws_elasticache_subnet_group" "main" {
  name       = "${var.project_name}-${var.environment}-cache-subnets"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id       = "${replace(var.project_name, "_", "-")}-${var.environment}-redis"
  description                = "Redis for ${var.project_name} (${var.environment})"
  engine                     = "redis"
  engine_version             = "7.1"
  node_type                  = var.redis_node_type
  parameter_group_name       = "default.redis7"
  num_cache_clusters         = 1
  port                       = 6379
  automatic_failover_enabled = false
  multi_az_enabled           = false
  apply_immediately          = true
  security_group_ids         = [aws_security_group.redis.id]
  subnet_group_name          = aws_elasticache_subnet_group.main.name
  at_rest_encryption_enabled = true
  transit_encryption_enabled = false
}
